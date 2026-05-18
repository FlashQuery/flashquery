---
fq_id: 31749b8e-6d56-43a7-8b96-65a62fb3c5c3
fq_title: Corpus Flashquery
fq_created: '2026-05-17T22:47:40.298+00:00'
fq_status: active
fq_instance: work-center
fq_updated: '2026-05-17T22:50:53.835Z'
---
# FlashQuery-Native Tool Corpus (Empirical-Check Slice)

Synthetic corpus slice added 2026-05-15 for the `call_macro` ranking validation discussed in [JIT-Compiled Macros Research §15](../JIT-Compiled%20Macros%20Research.md#15-call_macros-place-in-the-tool-surface) and [Native Tool Search §5.7.11.1](../Native%20Tool%20Search%20Research.md#57111-worked-example-call_macro-as-the-multitool).

**Not scraped from a public MCP server.** Tool descriptions are representative of expected FlashQuery v1 wire-format style — concise, action-focused, matching the typical MCP description shape — but written by hand rather than scraped. Used to test whether BM25 naturally ranks `call_macro` below direct tools for single-operation queries and above (or alongside) them for compound/composition-shaped queries.

The slice covers the I/O surface most likely to compose well via macros (writes, moves, sections, tags) plus `call_macro` itself. Read-only tools like `get_briefing` and `list_vault` are included for query disambiguation.

## Server: flashquery

FlashQuery's native MCP surface — vault management, document I/O, memory, records, and the macro execution engine.

### Tool: write_document

```json
{
  "name": "write_document",
  "description": "Create or fully overwrite a document in the FlashQuery vault at the given path. Sets frontmatter and body content in one call. For partial updates to an existing document, use replace_doc_section or insert_in_doc instead.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "path": {"type": "string", "description": "Vault-relative path for the document"},
      "content": {"type": "string", "description": "Full document body in Markdown"},
      "frontmatter": {"type": "object", "description": "Optional YAML frontmatter fields"},
      "help": {"type": "boolean", "description": "Pass true to receive this tool's help page instead of writing"}
    },
    "required": ["path", "content"]
  }
}
```

### Tool: get_document

```json
{
  "name": "get_document",
  "description": "Read a document from the FlashQuery vault by path. Returns the document's frontmatter, body content, parsed headings, and metadata.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "path": {"type": "string", "description": "Vault-relative path of the document to read"},
      "help": {"type": "boolean", "description": "Pass true for help"}
    },
    "required": ["path"]
  }
}
```

### Tool: replace_doc_section

```json
{
  "name": "replace_doc_section",
  "description": "Replace a single section of an existing FlashQuery document, identified by its heading. Targeted edit — only the named section is rewritten, the rest of the document is untouched.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "path": {"type": "string", "description": "Vault-relative path of the document"},
      "heading": {"type": "string", "description": "Heading text of the section to replace"},
      "new_content": {"type": "string", "description": "Replacement section body"},
      "help": {"type": "boolean", "description": "Pass true for help"}
    },
    "required": ["path", "heading", "new_content"]
  }
}
```

### Tool: insert_in_doc

```json
{
  "name": "insert_in_doc",
  "description": "Insert new content into an existing FlashQuery document at a specified anchor (heading, line number, or marker). Adds without replacing existing content.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "path": {"type": "string", "description": "Vault-relative path of the document"},
      "anchor": {"type": "string", "description": "Heading, line, or marker to insert relative to"},
      "content": {"type": "string", "description": "Content to insert"},
      "position": {"type": "string", "description": "before, after, or replace"},
      "help": {"type": "boolean", "description": "Pass true for help"}
    },
    "required": ["path", "anchor", "content"]
  }
}
```

### Tool: move_document

```json
{
  "name": "move_document",
  "description": "Move a document from one path to another within the FlashQuery vault. Updates internal links automatically.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "from_path": {"type": "string", "description": "Current path of the document"},
      "to_path": {"type": "string", "description": "Destination path"},
      "help": {"type": "boolean", "description": "Pass true for help"}
    },
    "required": ["from_path", "to_path"]
  }
}
```

### Tool: archive_document

```json
{
  "name": "archive_document",
  "description": "Move a FlashQuery document to the archive folder, marking it as no longer active. Reversible.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "path": {"type": "string", "description": "Vault-relative path of the document to archive"},
      "help": {"type": "boolean", "description": "Pass true for help"}
    },
    "required": ["path"]
  }
}
```

### Tool: copy_document

```json
{
  "name": "copy_document",
  "description": "Copy a FlashQuery document to a new path within the vault. Original remains in place.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "from_path": {"type": "string", "description": "Source document path"},
      "to_path": {"type": "string", "description": "Destination path"},
      "help": {"type": "boolean", "description": "Pass true for help"}
    },
    "required": ["from_path", "to_path"]
  }
}
```

### Tool: apply_tags

```json
{
  "name": "apply_tags",
  "description": "Add or remove tags on a FlashQuery document's frontmatter tag list. Existing tags can be appended or replaced.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "path": {"type": "string", "description": "Vault-relative path of the document"},
      "tags_to_add": {"type": "array", "description": "Tags to add"},
      "tags_to_remove": {"type": "array", "description": "Tags to remove"},
      "help": {"type": "boolean", "description": "Pass true for help"}
    },
    "required": ["path"]
  }
}
```

### Tool: search

```json
{
  "name": "search",
  "description": "Full-text search across documents in the FlashQuery vault. Returns ranked results with content snippets and matching metadata.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": {"type": "string", "description": "Search query string"},
      "filter_tags": {"type": "array", "description": "Optional tag filter"},
      "limit": {"type": "number", "description": "Maximum results to return"},
      "help": {"type": "boolean", "description": "Pass true for help"}
    },
    "required": ["query"]
  }
}
```

### Tool: list_vault

```json
{
  "name": "list_vault",
  "description": "List documents in the FlashQuery vault, optionally filtered by directory, tags, or status. Returns paths and lightweight metadata.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "directory": {"type": "string", "description": "Vault-relative directory to list"},
      "filter_tags": {"type": "array", "description": "Optional tag filter"},
      "help": {"type": "boolean", "description": "Pass true for help"}
    }
  }
}
```

### Tool: write_memory

```json
{
  "name": "write_memory",
  "description": "Write a memory note to the FlashQuery persistent memory store. Used for user preferences, project facts, references, or guidance the assistant should recall across sessions.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "name": {"type": "string", "description": "Memory name (file-friendly identifier)"},
      "content": {"type": "string", "description": "Memory content body"},
      "memory_type": {"type": "string", "description": "user, feedback, project, or reference"},
      "help": {"type": "boolean", "description": "Pass true for help"}
    },
    "required": ["name", "content", "memory_type"]
  }
}
```

### Tool: get_memory

```json
{
  "name": "get_memory",
  "description": "Retrieve a memory note from the FlashQuery persistent memory store by name.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "name": {"type": "string", "description": "Memory name to retrieve"},
      "help": {"type": "boolean", "description": "Pass true for help"}
    },
    "required": ["name"]
  }
}
```

### Tool: write_record

```json
{
  "name": "write_record",
  "description": "Write a structured record to the FlashQuery vault. Records are typed, queryable documents used for tracking work items, decisions, and other structured data.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "record_type": {"type": "string", "description": "Type of record (task, decision, log, etc.)"},
      "fields": {"type": "object", "description": "Record field values"},
      "help": {"type": "boolean", "description": "Pass true for help"}
    },
    "required": ["record_type", "fields"]
  }
}
```

### Tool: call_macro

```json
{
  "name": "call_macro",
  "description": "Execute a FlashQuery macro to chain multiple tool operations, pass intermediate results between them, or run conditional logic in a single round-trip. Use for compound or composite work that combines several individual FlashQuery tool calls into one orchestrated execution. The macro language supports variables, conditionals, loops, and composition of any FlashQuery-native or brokered tool, with intermediate state held inside the engine rather than in the conversation context. For one-shot single-tool operations, prefer the direct tool. Pass help:true for syntax and patterns.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "script": {"type": "string", "description": "Macro script source (FlashQuery macro language)"},
      "variables": {"type": "object", "description": "Initial variable bindings for the macro"},
      "help": {"type": "boolean", "description": "Pass true to receive the macro syntax guide and example patterns"}
    },
    "required": ["script"]
  }
}
```
