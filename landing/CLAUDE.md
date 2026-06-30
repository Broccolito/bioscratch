# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commit Rules

**Never add `Co-Authored-By` lines to commit messages in this repo.** A `commit-msg` hook in `.githooks/commit-msg` enforces this. After cloning, activate it once:

```bash
git config core.hooksPath .githooks
```

A GitHub Actions workflow (`.github/workflows/no-claude-coauthor.yml`) enforces the same rule server-side on every push and PR.

## Overview

Static landing page for the [Bioscratch](https://github.com/Broccolito/bioscratch) desktop app. No build system — everything is in a single `index.html` with embedded CSS and JS. Deployed to GitHub Pages at [broccolito.github.io/bioscratch-landing](https://broccolito.github.io/bioscratch-landing/).

## Commands

No build step. To preview locally:

```bash
python -m http.server 8000   # then open http://localhost:8000
# or
npx serve .
```

Deploy by pushing to `main` — GitHub Pages serves `index.html` automatically.

## Structure

Everything lives in `index.html` (~634 lines): embedded `<style>` (lines 9–397), HTML sections, and a small `<script>` at the bottom (Intersection Observer for scroll-triggered card animations).

Sections in order: nav → hero (title + three-pillar value props + download CTAs) → features grid (9 cards) → download section → footer.

## Key Conventions

- **No external CSS/JS files** — keep everything in `index.html` for simplicity
- **CSS custom properties** — colors defined as vars at the top of the `<style>` block; never hardcode colors elsewhere
- **CSS section comments** use `/* ─── SECTION NAME ─── */` dividers
- **Button variants**: `.btn-filled` (primary/dark CTA) and `.btn-ghost` (secondary)
- **SVG icons** are inline with `aria-hidden="true"`
- **Single responsive breakpoint** at 680px

## Version Updates

Download links in the hero and download sections hardcode the version (e.g. `v0.1.2`) and DMG filenames pointing to GitHub releases. Update these when the main app cuts a new release. The main app version is in `app/package.json` and `app/src-tauri/Cargo.toml` in the bioscratch repo.
