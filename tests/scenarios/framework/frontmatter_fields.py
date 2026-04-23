"""
Centralized FlashQuery-managed frontmatter field name constants.

Mirrors ``src/constants/frontmatter-fields.ts`` — if you rename a field,
update that TypeScript file AND this one.  Every Python test or framework
module that reads or writes FlashQuery-managed frontmatter keys should
import ``FM`` from here instead of using bare string literals.

Usage::

    from frontmatter_fields import FM

    fq_id = doc.frontmatter.get(FM.ID)
    fm[FM.OWNER] = plugin_id
    extra_frontmatter = {FM.TYPE: doc_type, FM.OWNER: plugin_id}
"""

from __future__ import annotations


class FM:
    """Namespace of FlashQuery-managed frontmatter field name constants.

    Key order mirrors the preferred write order defined in
    ``src/constants/frontmatter-fields.ts``: user-defined fields are
    written first (handled by ``serializeOrderedFrontmatter``); within
    the FlashQuery block the order is TITLE → STATUS → TAGS → CREATED →
    UPDATED → OWNER → TYPE → INSTANCE → ID.
    """

    TITLE:    str = "fq_title"
    STATUS:   str = "fq_status"
    TAGS:     str = "fq_tags"
    CREATED:  str = "fq_created"
    UPDATED:  str = "fq_updated"
    OWNER:    str = "fq_owner"
    TYPE:     str = "fq_type"
    INSTANCE: str = "fq_instance"
    ID:       str = "fq_id"

    # All managed fields in preferred write order — matches _ORDERED_FIELDS
    # in fqc_vault.py and preserveOrder in frontmatter-sanitizer.ts.
    ALL: tuple[str, ...] = (
        TITLE, STATUS, TAGS, CREATED, UPDATED,
        OWNER, TYPE, INSTANCE, ID,
    )

    # Convenience set for membership tests
    SET: frozenset[str] = frozenset(ALL)
