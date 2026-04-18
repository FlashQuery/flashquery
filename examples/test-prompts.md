# FlashQuery — Manual Smoke Test Prompts

After connecting FlashQuery to Claude Desktop or Claude Code, paste these prompts to verify the full pipeline. Replace `[YourProject]` with an actual "Area/Project" path from your config (e.g., `"Personal/Journal"` or `"Work/Acme Corp"`).

---

## Prompt 1: Save a Memory (`save_memory`)

```
Save this as a memory: The weekly standup moved to Tuesdays at 10am. Tag it with "meetings" and scope it to the [YourProject] project.
```

**Expected behavior:** Claude calls `save_memory` with your content, project, and tags. It returns a confirmation with the memory ID. Example response:
> Memory saved (id: abc-123). Project: [YourProject]. Tags: meetings.

---

## Prompt 2: Search Memories (`search_memory`)

```
Search my memories for anything about standup meetings.
```

**Expected behavior:** Claude calls `search_memory` with a semantic query. It returns ranked results showing the memory you just saved, along with a similarity percentage, ID, and project. Example response:
> Found 1 memory:
> 1. [95% match] The weekly standup moved to Tuesdays at 10am.
>    ID: abc-123 | Project: [YourProject] | Tags: meetings

---

## Prompt 3: Create a Document (`create_document`)

```
Create a document titled "Meeting Notes - March 2026" in the [YourProject] project with the content: "Discussed Q2 roadmap priorities and assigned owners for each initiative." Add the tags "meetings" and "planning".
```

**Expected behavior:** Claude calls `create_document`. The file is created in your vault at `[YourProject]/Meeting Notes - March 2026.md` with YAML frontmatter including `fqc_id`, `project`, `tags`, `status`, and timestamps. Example response:
> Document created: [YourProject]/Meeting Notes - March 2026.md
> fqc_id: def-456
> Project: [YourProject]
> Tags: meetings, planning

---

## Prompt 4: List Projects (`list_projects`)

```
List all my FlashQuery projects.
```

**Expected behavior:** Claude calls `list_projects`. It returns all areas and projects configured in your `flashquery.yaml`, grouped by area. Example response:
> Found 2 project(s):
>
> ## Personal
> - **Journal**: Daily notes (id: ...)
>
> ## Work
> - **Acme Corp**: Client project (id: ...)

---

## Prompt 5: Get Project Info (`get_project_info`)

```
Get info about the [YourProject] project including memory and document counts.
```

**Expected behavior:** Claude calls `get_project_info` with your project path. It returns the project name, description, memory count (from Supabase), and document count (from the vault folder). Example response:
> Project: [YourProject]
> Description: ...
> Memories: 1
> Documents: 1

---

## Prompt 6: Get a Document (`get_document`)

```
Show me the document at [YourProject]/Meeting Notes - March 2026.md
```

**Expected behavior:** Claude calls `get_document` with the vault-relative path. It returns the full frontmatter as key-value pairs followed by the document body. Example response:
> ## Frontmatter
> title: "Meeting Notes - March 2026"
> project: "[YourProject]"
> tags: ["status/active","meetings","planning"]
> fqc_id: "def-456"
> status: "active"
> created: "2026-03-25T..."
>
> ## Content
> Discussed Q2 roadmap priorities and assigned owners for each initiative.

---

## Prompt 7: Search Documents (`search_documents`)

```
Search for documents tagged with "meetings".
```

**Expected behavior:** Claude calls `search_documents` with the `tags` filter. It returns all non-archived documents that have at least one matching tag, sorted by most recently modified. Example response:
> 1. Meeting Notes - March 2026
>    Path: [YourProject]/Meeting Notes - March 2026.md | Project: [YourProject] | Tags: status/active, meetings, planning

---

## Full Pipeline Verification Checklist

After running all 7 prompts, verify:

- [ ] Memory appears in your Supabase `fqc_memory` table (check the Supabase dashboard or table editor)
- [ ] Document file exists in your vault at `[vault-path]/[YourProject]/Meeting Notes - March 2026.md`
- [ ] Document has correct YAML frontmatter (open in any text editor or Obsidian)
- [ ] All 7 Claude responses were non-error responses (no `Error:` prefix in output)

If any step fails, check:
1. FlashQuery startup logs (stderr in Claude's developer console)
2. Supabase connection — is the instance running and the credentials correct?
3. Vault path — does the directory exist and is it writable?
4. Embedding provider — is the API key valid and the model name correct?
