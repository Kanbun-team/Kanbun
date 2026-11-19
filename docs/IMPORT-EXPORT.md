# Import, export and backup

Kanbun can bring boards in from Trello, CSV files and its own exports, and can export boards and the whole instance. Admins can also download a full backup. Every import, export and backup is recorded in the admin audit log.

## Importing a board (Trello or Kanbun JSON)

Open **Boards > New board > Import** (or go to `/tasks/import`) and choose a `.json` file. The file becomes a new board owned by you. Kanbun recognizes the format from the content. Files up to 20 MB are accepted (`IMPORT_MAX_MB` changes the limit). The import runs in one database transaction: if anything fails, nothing is created.

### From Trello

In Trello, open the board menu, then **Print, export and share > Export as JSON**, and save the file.

| Trello | Kanbun |
|---|---|
| Open lists | Columns, in Trello's order |
| Closed (archived) lists | Skipped, together with all their cards |
| Cards (name, description, due date, cover color) | Cards. The due date becomes the deadline (calendar date, UTC) |
| Closed (archived) cards | Skipped. The import summary says how many lists and cards were left out |
| Labels | Board tags. Colors map to the closest Kanbun palette hue; an unnamed label is named after its color |
| Checklists | The card checklist (title, done, order). With several checklists, items are prefixed with the checklist name |
| Comments (`commentCard` actions) | Comments posted by you, starting with "Originally by *full name* on *date*", in the original order |
| Card members | Assignees, when a Kanbun user has the same username. They are added to the board as members. Others are listed in the summary and left out |

Attachments, custom fields, power-ups, stickers and votes are not imported.

### From a Kanbun export

Any Kanbun JSON export (a single board, or the full admin export) can be imported. Each board in the file becomes a new board. Members, tags, columns, cards, checklists, comments, blockers and card templates are recreated. People are matched by username: comments by users who exist keep their author, others are posted by you with an "Originally by" line. If the file has card history (exported "with card history"), it is restored too; otherwise each card gets a "created" entry. Attachment files are not part of exports (use the backup for those).

## Importing cards from CSV

In a board's **Settings > Import and export**, choose a CSV file. Kanbun detects the separator (comma, semicolon or tab), reads quoted fields with line breaks, and ignores a byte order mark. Before anything is written you see:

- which file column feeds each card field (guessed from the headers, changeable),
- the first rows as they will be imported,
- every problem, by line.

| Field | Accepted values |
|---|---|
| `title` (required) | Any text. Rows without a title are skipped |
| `description` | Markdown text |
| `column` | A column name (any case). Unknown names create a new column at the end; empty means the first column |
| `priority` | `low`, `normal`, `high`, `critical` (also `urgent`, `medium` and the priority names of every UI language, such as `hoch`, `haute` or `crítica`). Anything else becomes `normal` with a warning |
| `deadline` | `YYYY-MM-DD` (a time part is ignored), `DD.MM.YYYY` or `DD/MM/YYYY`. Invalid dates are dropped with a warning |
| `tags` | Names separated by commas or semicolons. Unknown tags are created |
| `assignees` | Usernames separated by commas. Users who are not members of the board are left out with a warning |

Cards are added at the end of their columns. A CSV import holds at most 5000 rows.

## Exporting

- **Board JSON**: board settings, **Export > Download JSON**. "JSON with card history" also includes each card's activity. Anyone who can open a board can export it via `GET /api/boards/<id>/export?format=json[&activity=1]`.
- **Board CSV**: **Export > Download CSV** (`?format=csv`). One row per card with the columns `title, description, column, priority, deadline, tags, assignees, checklist, created`. The file starts with a byte order mark so spreadsheets read it as UTF-8, and values that a spreadsheet would run as a formula are prefixed with `'` (the CSV import removes it again).
- **Everything** (admins): **Admin > Backup and export > Export everything** (`GET /api/admin/export[?activity=1]`). Every board including archived ones, users (without passwords) and categories.

### The Kanbun export format (version 1)

```json
{
  "format": "kanbun-export",
  "version": 1,
  "kind": "board",
  "exportedAt": "2026-11-18T10:00:00.000Z",
  "app": { "name": "Kanbun", "version": "1.0.0" },
  "boards": [
    {
      "name": "Website relaunch",
      "description": "New marketing site",
      "color": "#2563eb",
      "archived": false,
      "category": "Product",
      "createdAt": "2026-05-01T09:00:00.000Z",
      "members": [{ "username": "ada", "role": "owner" }],
      "tags": [{ "name": "design", "color": "#7c3aed" }],
      "templates": [
        { "name": "Bug", "title": "Bug: ", "description": null, "priority": "high", "tags": ["design"], "checklist": ["Reproduce"] }
      ],
      "columns": [
        {
          "name": "To do",
          "wipLimit": null,
          "cards": [
            {
              "id": "cm3abc",
              "title": "Hero section",
              "description": "Markdown text",
              "priority": "high",
              "coverColor": null,
              "deadline": "2026-12-01",
              "createdAt": "2026-11-01T10:00:00.000Z",
              "createdBy": "ada",
              "tags": ["design"],
              "assignees": ["marta"],
              "checklist": [{ "title": "Sketch", "done": true, "dueDate": null, "assignee": null }],
              "comments": [{ "author": "ada", "body": "Looks good", "createdAt": "2026-11-02T08:00:00.000Z" }],
              "blocks": ["cm3def"],
              "attachments": [{ "fileName": "hero.png", "mimeType": "image/png", "size": 48213, "createdAt": "2026-11-02T08:00:00.000Z" }],
              "activity": [{ "type": "moved", "data": { "from": "Backlog", "to": "To do" }, "actor": "ada", "createdAt": "2026-11-03T08:00:00.000Z" }]
            }
          ]
        }
      ]
    }
  ]
}
```

Notes:

- `kind` is `board` for a board export and `full` for the admin export, which also has `users` (`username`, `displayName`, `role`, `email`, `deactivated`, `createdAt`) and `categories` (`name`, `color`).
- People are always usernames, never internal ids, so a file can move between instances.
- Card `id`s only link `blocks` (the cards this card blocks) inside the file. Importing creates new ids.
- Dates are ISO 8601 in UTC; `deadline` and checklist `dueDate` are calendar dates (`YYYY-MM-DD`).
- `activity` is only present in exports "with card history". Since v1.4, created and moved entries also carry the column ids of the exporting server (`columnId`, `fromId`, `toId`); an import keeps them, and board insights fall back to the column names when they do not match. `attachments` lists metadata only.
- A future incompatible change gets a new `version`. Kanbun refuses versions it does not know instead of guessing.

## Backup and restore

See [README.md, Backup and restore](../README.md#backup-and-restore).
