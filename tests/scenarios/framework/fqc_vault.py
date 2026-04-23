"""
FlashQuery Vault Helper
=============================
Python helpers for reading, writing, and querying markdown files in a
FlashQuery vault — matching FQC's own conventions exactly.

Prerequisites:
    pip install pyyaml python-dotenv

Configuration:
    Vault path is auto-discovered from flashquery.yml (instance.vault.path),
    or can be passed explicitly.

Usage:
    from fqc_vault import VaultHelper

    vault = VaultHelper()                          # auto-discovers vault path
    vault = VaultHelper(vault_path="/path/to/vault")  # explicit

    # Create a file
    path = vault.create_file(
        "clients/acme/meeting-notes.md",
        title="Meeting Notes",
        body="## Discussion\\n\\n- Budget review",
        tags=["acme", "meetings"],
    )

    # Read a file
    doc = vault.read_file("clients/acme/meeting-notes.md")
    print(doc.frontmatter["title"])
    print(doc.body)

    # Check existence
    assert vault.exists("clients/acme/meeting-notes.md")

    # Search
    results = vault.find_files(tags=["acme"])
    results = vault.find_files(title_contains="Meeting")
    results = vault.find_files(glob="clients/**/*.md")
"""

from __future__ import annotations

import fnmatch
import os
import re
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

try:
    import yaml
except ImportError:
    yaml = None  # type: ignore[assignment]

# Re-use config discovery from fqc_client
from fqc_client import _load_yaml_config, _find_project_dir


# ---------------------------------------------------------------------------
# YAML helpers — match gray-matter / js-yaml output conventions
# ---------------------------------------------------------------------------

class _FlowList(list):
    """Marker so the YAML dumper renders this list in flow style: [a, b, c]."""
    pass


def _flow_list_representer(dumper: yaml.Dumper, data: _FlowList) -> Any:
    return dumper.represent_sequence("tag:yaml.org,2002:seq", data, flow_style=True)


def _str_representer(dumper: yaml.Dumper, data: str) -> Any:
    """Use plain style for most strings; use quoted style for ISO dates and
    for strings that would be misinterpreted by a YAML parser (e.g. scientific
    notation like '547171e0', booleans like 'true', nulls like 'null')."""
    if re.match(r"^\d{4}-\d{2}-\d{2}T", data):
        return dumper.represent_scalar("tag:yaml.org,2002:str", data, style='"')
    try:
        parsed = yaml.safe_load(data)
        if not isinstance(parsed, str) or parsed != data:
            return dumper.represent_scalar("tag:yaml.org,2002:str", data, style='"')
    except Exception:
        pass
    return dumper.represent_scalar("tag:yaml.org,2002:str", data)


def _get_dumper() -> type:
    """Return a YAML Dumper configured to match FQC's serialization."""
    dumper = yaml.Dumper
    dumper.add_representer(_FlowList, _flow_list_representer)
    dumper.add_representer(str, _str_representer)
    return dumper


# ---------------------------------------------------------------------------
# Frontmatter constants — sourced from the single source of truth
# ---------------------------------------------------------------------------

from frontmatter_fields import FM  # noqa: E402  (after sys.path manipulation above)

_ORDERED_FIELDS = FM.ALL
_EXCLUDED_FIELDS = frozenset({
    "content_hash", "ownership_plugin_id", "discovery_status",
    "embedding", "instance_id",
})


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class VaultDocument:
    """Parsed vault markdown file."""
    relative_path: str
    absolute_path: str
    frontmatter: dict[str, Any]
    body: str

    # Convenience accessors
    @property
    def fq_id(self) -> str | None:
        return self.frontmatter.get(FM.ID)

    @property
    def fq_title(self) -> str | None:
        return self.frontmatter.get(FM.TITLE)

    @property
    def fq_tags(self) -> list[str]:
        return self.frontmatter.get(FM.TAGS, []) or []

    @property
    def fq_status(self) -> str | None:
        return self.frontmatter.get(FM.STATUS)

    # Backward-compat aliases for test files not yet migrated to fq_* names
    fqc_id = property(lambda self: self.fq_id)
    title = property(lambda self: self.fq_title)
    tags = property(lambda self: self.fq_tags)
    status = property(lambda self: self.fq_status)


# ---------------------------------------------------------------------------
# Filename / folder sanitization — mirrors FQC conventions
# ---------------------------------------------------------------------------

_FILENAME_ILLEGAL = re.compile(r'[/\\:*?"<>|]')
_FOLDER_ILLEGAL = re.compile(r'[:\\/?*|<>]')
_MULTI_SPACE = re.compile(r" {2,}")


def sanitize_filename(title: str) -> str:
    """Sanitize a title into a safe filename (without extension)."""
    name = _FILENAME_ILLEGAL.sub("", title)
    name = _MULTI_SPACE.sub(" ", name).strip()
    return name


def sanitize_foldername(name: str) -> str:
    """Sanitize a folder name."""
    name = _FOLDER_ILLEGAL.sub(" ", name)
    name = _MULTI_SPACE.sub(" ", name).strip()
    return name


# ---------------------------------------------------------------------------
# Frontmatter parsing (minimal gray-matter equivalent)
# ---------------------------------------------------------------------------

_FM_DELIM = re.compile(r"^---\s*\n", re.MULTILINE)


def _parse_markdown(raw: str) -> tuple[dict[str, Any], str]:
    """Parse YAML frontmatter from a markdown string. Returns (frontmatter, body)."""
    if not raw.startswith("---"):
        return {}, raw

    # Find the closing ---
    end = raw.find("\n---", 3)
    if end == -1:
        return {}, raw

    fm_str = raw[4:end]  # between opening --- and closing ---
    body = raw[end + 4:]  # after closing ---\n
    if body.startswith("\n"):
        body = body[1:]  # strip the single blank line after ---

    if yaml is None:
        return {}, raw

    try:
        fm = yaml.safe_load(fm_str)
    except yaml.YAMLError:
        return {}, raw

    return (fm if isinstance(fm, dict) else {}), body


def _serialize_frontmatter(fm: dict[str, Any]) -> str:
    """Serialize frontmatter dict to YAML string in FQC field order."""
    if yaml is None:
        raise RuntimeError("pyyaml is required: pip install pyyaml")

    ordered: dict[str, Any] = {}

    # Ordered fields first
    for key in _ORDERED_FIELDS:
        if key in fm:
            val = fm[key]
            # Tags should render as flow-style list
            if key == FM.TAGS and isinstance(val, list):
                val = _FlowList(val)
            ordered[key] = val

    # Remaining fields (excluding internal-only ones)
    for key, val in fm.items():
        if key not in ordered and key not in _EXCLUDED_FIELDS:
            if isinstance(val, list):
                val = _FlowList(val)
            ordered[key] = val

    return yaml.dump(ordered, Dumper=_get_dumper(), default_flow_style=False,
                     sort_keys=False, allow_unicode=True)


def _now_iso() -> str:
    """Current UTC time as ISO 8601 string matching FQC format."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + \
           f"{datetime.now(timezone.utc).microsecond // 1000:03d}Z"


# ---------------------------------------------------------------------------
# VaultHelper
# ---------------------------------------------------------------------------

class VaultHelper:
    """Filesystem operations on a FlashQuery vault directory."""

    def __init__(
        self,
        vault_path: str | Path | None = None,
        fqc_dir: str | Path | None = None,
    ) -> None:
        resolved = vault_path

        if resolved is None:
            # Auto-discover from flashquery.yml
            dir_hint = fqc_dir or os.environ.get("FQC_DIR")
            project_dir = Path(dir_hint) if dir_hint else _find_project_dir()
            if project_dir:
                cfg = _load_yaml_config(project_dir)
                instance = cfg.get("instance", {}) or {}
                vault = instance.get("vault", {}) or {}
                raw_path = vault.get("path", "")
                if raw_path:
                    resolved = raw_path
                    # Resolve relative paths against the config file's directory
                    if not os.path.isabs(resolved):
                        resolved = str(project_dir / resolved)

        if not resolved:
            raise ValueError(
                "Cannot determine vault path. Provide vault_path explicitly, "
                "set instance.vault.path in flashquery.yml, or set FQC_DIR."
            )

        self.vault_root = Path(resolved).resolve()
        self._extensions = (".md",)  # could read from config if needed

    # ------------------------------------------------------------------
    # Path helpers
    # ------------------------------------------------------------------

    def _abs(self, relative_path: str) -> Path:
        """Resolve a vault-relative path to absolute, with traversal check."""
        p = (self.vault_root / relative_path).resolve()
        if not str(p).startswith(str(self.vault_root)):
            raise ValueError(f"Path traversal rejected: {relative_path}")
        return p

    # ------------------------------------------------------------------
    # Existence & listing
    # ------------------------------------------------------------------

    def exists(self, relative_path: str) -> bool:
        """Check if a file exists in the vault."""
        return self._abs(relative_path).is_file()

    def list_files(
        self,
        directory: str = "",
        recursive: bool = True,
    ) -> list[str]:
        """
        List markdown files in the vault, returned as vault-relative paths.

        Args:
            directory: Subdirectory to list (relative to vault root). Empty = whole vault.
            recursive: If True, walk subdirectories.
        """
        root = self._abs(directory) if directory else self.vault_root
        if not root.is_dir():
            return []

        results: list[str] = []
        if recursive:
            for dirpath, _, filenames in os.walk(root):
                for f in sorted(filenames):
                    if any(f.endswith(ext) for ext in self._extensions):
                        abs_path = Path(dirpath) / f
                        rel = str(abs_path.relative_to(self.vault_root))
                        results.append(rel)
        else:
            for f in sorted(root.iterdir()):
                if f.is_file() and any(f.name.endswith(ext) for ext in self._extensions):
                    results.append(str(f.relative_to(self.vault_root)))

        return results

    # ------------------------------------------------------------------
    # Read
    # ------------------------------------------------------------------

    def read_file(self, relative_path: str) -> VaultDocument:
        """Read and parse a vault markdown file."""
        abs_path = self._abs(relative_path)
        if not abs_path.is_file():
            raise FileNotFoundError(f"Not found in vault: {relative_path}")

        raw = abs_path.read_text(encoding="utf-8")
        fm, body = _parse_markdown(raw)

        return VaultDocument(
            relative_path=relative_path,
            absolute_path=str(abs_path),
            frontmatter=fm,
            body=body,
        )

    def read_frontmatter(self, relative_path: str) -> dict[str, Any]:
        """Read only the frontmatter of a vault file (lighter than read_file)."""
        return self.read_file(relative_path).frontmatter

    # ------------------------------------------------------------------
    # Write / create
    # ------------------------------------------------------------------

    def create_file(
        self,
        relative_path: str,
        title: str,
        body: str = "",
        tags: list[str] | None = None,
        status: str = "active",
        fqc_id: str | None = None,
        extra_frontmatter: dict[str, Any] | None = None,
    ) -> str:
        """
        Create a new markdown file in the vault with proper FQC frontmatter.

        Uses the atomic .fqc-tmp write pattern.

        Args:
            relative_path: Vault-relative path (e.g. "clients/acme/notes.md").
            title: Document title for frontmatter.
            body: Markdown body content.
            tags: Optional list of tags (will be lowercased and deduplicated).
            status: Document status (default: "active").
            fqc_id: Optional UUID. Auto-generated if not provided.
            extra_frontmatter: Additional frontmatter fields.

        Returns:
            The vault-relative path of the created file.
        """
        abs_path = self._abs(relative_path)

        # Normalize tags
        normalized_tags: list[str] = []
        seen: set[str] = set()
        for t in (tags or []):
            t_lower = t.strip().lower()
            if t_lower and t_lower not in seen:
                normalized_tags.append(t_lower)
                seen.add(t_lower)

        now = _now_iso()
        fm: dict[str, Any] = {
            FM.TITLE:   title,
            FM.STATUS:  status,
            FM.TAGS:    normalized_tags,
            FM.CREATED: now,
            FM.UPDATED: now,
            FM.ID:      fqc_id or str(uuid4()),
        }
        if extra_frontmatter:
            for k, v in extra_frontmatter.items():
                if k not in _EXCLUDED_FIELDS and k not in fm:
                    fm[k] = v

        fm_yaml = _serialize_frontmatter(fm)
        markdown = f"---\n{fm_yaml}---\n\n{body}"

        # Atomic write
        abs_path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = abs_path.with_name(abs_path.name + ".fqc-tmp")
        tmp_path.write_text(markdown, encoding="utf-8")
        tmp_path.rename(abs_path)

        return relative_path

    def write_frontmatter(
        self,
        relative_path: str,
        updates: dict[str, Any],
        touch_updated: bool = True,
    ) -> None:
        """
        Update specific frontmatter fields on an existing file without
        rewriting the body. Uses atomic write.

        Args:
            relative_path: Vault-relative path.
            updates: Dict of fields to set/overwrite.
            touch_updated: If True (default), set `updated` to now.
        """
        doc = self.read_file(relative_path)
        fm = {**doc.frontmatter, **updates}
        if touch_updated:
            fm[FM.UPDATED] = _now_iso()

        fm_yaml = _serialize_frontmatter(fm)
        markdown = f"---\n{fm_yaml}---\n\n{doc.body}"

        abs_path = self._abs(relative_path)
        tmp_path = abs_path.with_name(abs_path.name + ".fqc-tmp")
        tmp_path.write_text(markdown, encoding="utf-8")
        tmp_path.rename(abs_path)

    # ------------------------------------------------------------------
    # Delete (for test cleanup)
    # ------------------------------------------------------------------

    def delete_file(self, relative_path: str) -> bool:
        """Delete a file from the vault. Returns True if it existed."""
        abs_path = self._abs(relative_path)
        if abs_path.is_file():
            abs_path.unlink()
            return True
        return False

    def delete_directory(self, relative_path: str) -> bool:
        """Recursively delete a directory from the vault. Returns True if it existed."""
        import shutil
        abs_path = self._abs(relative_path)
        if abs_path.is_dir():
            shutil.rmtree(abs_path)
            return True
        return False

    # ------------------------------------------------------------------
    # Search / find
    # ------------------------------------------------------------------

    def find_files(
        self,
        directory: str = "",
        glob: str | None = None,
        tags: list[str] | None = None,
        tag_match: str = "any",
        title_contains: str | None = None,
        status: str | None = None,
        frontmatter_match: dict[str, Any] | None = None,
        limit: int | None = None,
    ) -> list[VaultDocument]:
        """
        Find vault documents matching the given criteria.

        All criteria are ANDed together. Returns parsed VaultDocument objects.

        Args:
            directory: Subdirectory to search (vault-relative). Empty = whole vault.
            glob: Glob pattern matched against vault-relative paths (e.g. "clients/**/*.md").
            tags: Filter by tags.
            tag_match: "any" = document has at least one tag; "all" = document has every tag.
            title_contains: Case-insensitive substring match on title.
            status: Exact match on status field.
            frontmatter_match: Dict of field→value for exact match on arbitrary frontmatter fields.
            limit: Max results to return.

        Returns:
            List of matching VaultDocument objects.
        """
        candidates = self.list_files(directory=directory)

        # Apply glob filter first (cheap, no file reads)
        if glob:
            candidates = [p for p in candidates if fnmatch.fnmatch(p, glob)]

        results: list[VaultDocument] = []
        search_tags = set(t.strip().lower() for t in tags) if tags else None

        for rel_path in candidates:
            if limit is not None and len(results) >= limit:
                break

            try:
                doc = self.read_file(rel_path)
            except Exception:
                continue

            # Tag filter
            if search_tags:
                doc_tags = set(doc.tags)
                if tag_match == "all":
                    if not search_tags.issubset(doc_tags):
                        continue
                else:  # "any"
                    if not search_tags.intersection(doc_tags):
                        continue

            # Title filter
            if title_contains:
                doc_title = (doc.title or "").lower()
                if title_contains.lower() not in doc_title:
                    continue

            # Status filter
            if status and doc.status != status:
                continue

            # Arbitrary frontmatter match
            if frontmatter_match:
                skip = False
                for k, v in frontmatter_match.items():
                    if doc.frontmatter.get(k) != v:
                        skip = True
                        break
                if skip:
                    continue

            results.append(doc)

        return results

    def find_by_fqc_id(self, fqc_id: str, directory: str = "") -> VaultDocument | None:
        """Find a single document by its fq_id. Returns None if not found."""
        matches = self.find_files(
            directory=directory,
            frontmatter_match={FM.ID: fqc_id},
            limit=1,
        )
        return matches[0] if matches else None

    # ------------------------------------------------------------------
    # Assertions (convenience for test scripts)
    # ------------------------------------------------------------------

    def assert_exists(self, relative_path: str, msg: str = "") -> VaultDocument:
        """Assert a file exists and return its parsed content. Raises AssertionError if not."""
        if not self.exists(relative_path):
            raise AssertionError(msg or f"Expected file to exist: {relative_path}")
        return self.read_file(relative_path)

    def assert_not_exists(self, relative_path: str, msg: str = "") -> None:
        """Assert a file does NOT exist. Raises AssertionError if it does."""
        if self.exists(relative_path):
            raise AssertionError(msg or f"Expected file to NOT exist: {relative_path}")

    def assert_frontmatter(
        self,
        relative_path: str,
        expected: dict[str, Any],
        msg: str = "",
    ) -> VaultDocument:
        """
        Assert that a file exists and its frontmatter contains the expected values.
        Only checks the keys present in `expected` — other fields are ignored.
        """
        doc = self.assert_exists(relative_path)
        for key, expected_val in expected.items():
            actual_val = doc.frontmatter.get(key)
            if actual_val != expected_val:
                detail = (
                    f"Frontmatter mismatch on '{key}' in {relative_path}: "
                    f"expected {expected_val!r}, got {actual_val!r}"
                )
                raise AssertionError(msg or detail)
        return doc

    def assert_tag_present(self, relative_path: str, tag: str, msg: str = "") -> None:
        """Assert that a file has a specific tag."""
        doc = self.assert_exists(relative_path)
        if tag.lower() not in doc.tags:
            raise AssertionError(
                msg or f"Expected tag '{tag}' in {relative_path}, found: {doc.tags}"
            )

    def assert_body_contains(self, relative_path: str, substring: str, msg: str = "") -> None:
        """Assert that a file's body contains a substring."""
        doc = self.assert_exists(relative_path)
        if substring not in doc.body:
            raise AssertionError(
                msg or f"Expected body of {relative_path} to contain: {substring!r}"
            )


# ---------------------------------------------------------------------------
# CLI: quick vault inspection when run directly
# ---------------------------------------------------------------------------

def _cli() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="FlashQuery vault inspector")
    parser.add_argument("--fqc-dir", type=str, default=None, help="Path to flashquery-core directory")
    parser.add_argument("--vault", type=str, default=None, help="Explicit vault path (overrides config)")
    sub = parser.add_subparsers(dest="command")

    sub.add_parser("info", help="Show vault path and file count")

    ls = sub.add_parser("ls", help="List files")
    ls.add_argument("directory", nargs="?", default="", help="Subdirectory to list")

    read = sub.add_parser("read", help="Read a file")
    read.add_argument("path", help="Vault-relative path to read")

    find = sub.add_parser("find", help="Search files")
    find.add_argument("--tags", type=str, default=None, help="Comma-separated tags")
    find.add_argument("--title", type=str, default=None, help="Title substring")
    find.add_argument("--status", type=str, default=None, help="Status value")
    find.add_argument("--glob", type=str, default=None, help="Glob pattern")

    args = parser.parse_args()

    try:
        vault = VaultHelper(vault_path=args.vault, fqc_dir=args.fqc_dir)
    except ValueError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

    if args.command == "info" or args.command is None:
        files = vault.list_files()
        print(f"Vault root:  {vault.vault_root}")
        print(f"Files found: {len(files)}")

    elif args.command == "ls":
        for f in vault.list_files(directory=args.directory):
            print(f)

    elif args.command == "read":
        doc = vault.read_file(args.path)
        print(f"Title:   {doc.title}")
        print(f"FQC ID:  {doc.fqc_id}")
        print(f"Status:  {doc.status}")
        print(f"Tags:    {doc.tags}")
        print(f"---")
        print(doc.body)

    elif args.command == "find":
        tags = [t.strip() for t in args.tags.split(",")] if args.tags else None
        results = vault.find_files(
            tags=tags,
            title_contains=args.title,
            status=args.status,
            glob=args.glob,
        )
        if not results:
            print("No matches found.")
        for doc in results:
            print(f"  {doc.relative_path}  —  {doc.title}  [{', '.join(doc.tags)}]")


if __name__ == "__main__":
    _cli()
