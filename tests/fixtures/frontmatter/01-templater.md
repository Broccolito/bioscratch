---
Created at: <% tp.file.creation_date() %>
Modified at: <% tp.file.last_modified_date("dddd do MMMM YY HH:mm") %>
tags:
- Coding
- YAML
Aliases: []
---

# Templater note

This is the exact Obsidian + Templater shape that triggered the feature. The
`<% … %>` template expressions are **not** valid YAML on their own, so the
banner falls back to a forgiving line parse and still renders cleanly.

- `Created at` / `Modified at` should appear as date chips.
- `tags` should render as pills: `Coding`, `YAML`.
- `Aliases` is empty.
