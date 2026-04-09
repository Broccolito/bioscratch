# Bioscratch

<img src="logo.png" alt="Bioscratch Logo" width="80" />

A What You See Is What You Get (WYSIWYG) Markdown editor built for researchers, data scientists, and AI engineers — for humans and agents alike.

**[Download](https://github.com/Broccolito/bioscratch/releases)** · **[Report a Bug](https://github.com/Broccolito/bioscratch/issues)**

## Why Bioscratch?

The name comes from two places: **biosketch** — the academic format where researchers document their skills, projects, and contributions — and **scratch**, as in what you see while you're writing *is* what you get, no preview pane, no mode switching.

As `skill.md` files become a common way for researchers and engineers to represent expertise in a form that both humans and AI agents can read and parse, having a proper tool to write them starts to matter. Most Markdown editors still split the writing experience from the reading experience. Bioscratch doesn't. You type, you see. Tables render, math renders, diagrams render — right inline. The file on disk stays plain Markdown, readable by anything.

## Features

**True WYSIWYG editing** — Headings, bold, italic, lists, tables, task lists, code blocks with syntax highlighting, inline and block math (KaTeX), and Mermaid diagrams all render as you type. Click into anything to edit the raw syntax. No split pane, no mental context-switching.

**Opens almost anything** — `.md`, `.txt`, `.py`, `.r`, `.json`, `.yaml`, `.toml`, `.tex`, `.sql`, `.html`, `.ts`, `.go`, `.rs`, and more. Markdown-first, but works well for anything text-based.

**Export to HTML and PDF** — One-click export from the toolbar. **HTML export** produces a self-contained file with KaTeX math, syntax highlighting, and Mermaid diagrams bundled in. **PDF export** uses Pandoc for properly typeset output — local images, inline or block, are resolved automatically regardless of where the file lives.

**Mermaid diagram support** — Write flowcharts, sequence diagrams, and ERDs in fenced code blocks. They render live in the editor and carry through into HTML exports.

**30+ themes, fully customizable** — Ships with themes inspired by GitHub, IBM Carbon, Material Design, Apple, Spotify, NASA, Atlassian, Twitter/X, Medium, BBC, Audi, Mailchimp, Ubuntu, Ant Design, and more — **light and dark variants for each**. Don't like any of them? Drop a YAML file in the user themes folder and it appears in the selector immediately.

**Multi-tab, multi-window** — Open multiple files in tabs. **Drag a tab outside the tab bar** to detach it into its own window. Autosave runs every 30 seconds in the background, and crash recovery kicks in on next open if the autosave diverges from disk.

**Free and open source** — No account, no telemetry, no subscription. MIT licensed.

## Download

macOS only for now. Both chips supported:

| Build | Chip |
|---|---|
| `Bioscratch_*_aarch64.dmg` | Apple Silicon (M1 / M2 / M3 / M4) |
| `Bioscratch_*_x86_64.dmg` | Intel |

→ [Releases page](https://github.com/Broccolito/bioscratch/releases)

> **PDF export requires Pandoc.** Install it once:
> ```bash
> brew install pandoc
> ```

## Keyboard Shortcuts

| Action | Shortcut |
|---|---|
| Open file | `⌘O` |
| Save | `⌘S` |
| Save As | `⌘⇧S` |
| New tab | `⌘T` |
| Close tab | `⌘W` |
| Find | `⌘F` |
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
| PDF export | Pandoc |

## Developer

Bioscratch is developed and maintained by **Wanjun Gu** at the University of California, San Francisco (UCSF). For questions, feedback, or collaboration, reach out at [wanjun.gu@ucsf.edu](mailto:wanjun.gu@ucsf.edu).
