<p align="center"><img src="logo.png" alt="Bioscratch Logo" width="80" /></p>

<h1 align="center">Bioscratch</h1>

<p align="center">A What You See Is What You Get (WYSIWYG) Markdown editor built for researchers, data scientists, and AI engineers — for humans and agents alike.</p>

<p align="center"><strong><a href="https://broccolito.github.io/bioscratch/">Website</a></strong> · <strong><a href="https://github.com/Broccolito/bioscratch/releases">Download</a></strong> · <strong><a href="https://marketplace.visualstudio.com/items?itemName=WanjunGu.bioscratch">VS Code Marketplace</a></strong> · <strong><a href="https://github.com/Broccolito/bioscratch/issues">Report a Bug</a></strong></p>

## Why Bioscratch?

The name comes from two places: **biosketch** — the academic format where researchers document their skills, projects, and contributions — and **scratch**, as in what you see while you're writing *is* what you get, no preview pane, no mode switching.

As `skill.md` files become a common way for researchers and engineers to represent expertise in a form that both humans and AI agents can read and parse, having a proper tool to write them starts to matter. Most Markdown editors still split the writing experience from the reading experience. Bioscratch doesn't. You type, you see. Tables render, math renders, diagrams render — right inline. The file on disk stays plain Markdown, readable by anything.

## Features

**True WYSIWYG editing** — Headings, bold, italic, lists, tables, task lists, code blocks with syntax highlighting, inline and block math (KaTeX), and Mermaid diagrams all render as you type. Click into anything to edit the raw syntax. No split pane, no mental context-switching.

**Opens almost anything** — `.md`, `.txt`, `.py`, `.r`, `.json`, `.yaml`, `.toml`, `.tex`, `.sql`, `.html`, `.ts`, `.go`, `.rs`, and more. Markdown-first, but works well for anything text-based.

**Browse and search your folders** — Open any folder on your Mac (`⇧⌘O`) to get a file tree in the sidebar — no vault, nothing added to the folder. Double-click a folder to move into it; create, rename and move files and folders to the Trash right from the tree; jump to any file with Quick Open (`⌘P`); and go back and forward like a browser (`⌘[` / `⌘]`). Search finds text across the folder, including notes you haven't saved yet.

**Tags that other tools understand** — Add tags from the tag bar above the editor. They're stored as standard front-matter `tags:` — the same format Obsidian, Hugo and Jekyll use — with `/` for subtags (`lab/assays`). Filter search results, or the file tree itself, by any combination of tags; a parent tag includes its subtags.

**Export to HTML and PDF** — One-click export from the toolbar. **HTML export** produces a self-contained file with KaTeX math, syntax highlighting, and Mermaid diagrams bundled in. **PDF export** is rendered natively from the page you see — math, highlighted code, Mermaid diagrams, tables and local images included — with nothing extra to install.

**Mermaid diagram support** — Write flowcharts, sequence diagrams, and ERDs in fenced code blocks. They render live in the editor and carry through into HTML exports.

**30+ themes, fully customizable** — Ships with themes inspired by GitHub, IBM Carbon, Material Design, Apple, Spotify, NASA, Atlassian, Twitter/X, Medium, BBC, Audi, Mailchimp, Ubuntu, Ant Design, and more — **light and dark variants for each**. Don't like any of them? Drop a YAML file in the user themes folder and it appears in the selector immediately.

**Multi-tab, multi-window** — Open multiple files in tabs. **Drag a tab outside the tab bar** to detach it into its own window. Autosave runs every 30 seconds in the background, and crash recovery kicks in on next open if the autosave diverges from disk. Closing a window or quitting asks before discarding unsaved changes.

**Finder Quick Look** — Press Space on a Markdown file to read it with rendered math, diagrams, tables and code. macOS may restrict access to referenced local images in Quick Look; open the note in Bioscratch to view those images.

**Free and open source** — No account, no telemetry, no subscription. MIT licensed.

## Download

macOS only for now. Both chips supported:

| Build | Chip |
|---|---|
| `Bioscratch_*_aarch64.dmg` | Apple Silicon (M1 / M2 / M3 / M4) |
| `Bioscratch_*_x86_64.dmg` | Intel |

→ [Releases page](https://github.com/Broccolito/bioscratch/releases)

Prefer to stay in VS Code? Install
[Bioscratch from the VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=WanjunGu.bioscratch).

## Keyboard Shortcuts

| Action | Shortcut |
|---|---|
| Open file | `⌘O` |
| Save | `⌘S` |
| Save As | `⌘⇧S` |
| New tab | `⌘T` |
| Close tab | `⌘W` |
| Go to tab 1–8 / last tab | `⌘1`–`⌘8` / `⌘9` |
| Find | `⌘F` |
| Open folder | `⌘⇧O` |
| Quick open | `⌘P` |
| Search folder | `⌘⇧F` |
| Back / Forward | `⌘[` / `⌘]` |
| Toggle sidebar | `⌘\` |
| Bold | `⌘B` |
| Italic | `⌘I` |
| Inline code | `` ⌘` `` |
| Undo / Redo | `⌘Z` / `⌘⇧Z` |

Markdown input shortcuts also work inline: `##` + space for a heading, ` ``` ` for a code block, `- [ ]` for a task list item, `---` for a horizontal rule.

## Custom Themes

Themes are flat YAML files — each key maps directly to a CSS custom property on `:root`. To add your own, go to **Theme → Add Custom Theme** in the toolbar and paste something like:

```yaml
bg-editor: "#1e1e2e"
text-primary: "#cdd6f4"
accent: "#89b4fa"
border: "#313244"
```

Changes apply live. Theme files persist in `{AppData}/user_themes/` and survive updates.

## Building from Source

Requires [Rust](https://rustup.rs/), [Node.js ≥ 20](https://nodejs.org/), and the [Tauri v2 prerequisites](https://tauri.app/start/prerequisites/).

```bash
git clone https://github.com/Broccolito/bioscratch.git
cd bioscratch/app
npm install
npm run tauri dev      # dev mode with hot reload
npm run tauri build    # production .dmg
```

## Stack

| Layer | Technology |
|---|---|
| Desktop shell | Tauri v2 (Rust) |
| Frontend | React 19 + TypeScript + Vite |
| Editor engine | ProseMirror |
| Markdown parsing | unified / remark / remark-gfm / remark-math |
| Math | KaTeX |
| Syntax highlighting | highlight.js |
| Diagrams | Mermaid |
| PDF export | Native WebKit PDF rendering |

## Contributors

- **Wanjun Gu** — creator and maintainer
- **Tianlu Zhu** — contributor
- **Ilan Ladabaum** — contributor

## Developer

Bioscratch is developed and maintained by **Wanjun Gu** at the University of California, San Francisco (UCSF). For questions, feedback, or collaboration, reach out at [wanjun.gu@ucsf.edu](mailto:wanjun.gu@ucsf.edu).
