---
title: The Anatomy of a Good Banner
subtitle: How Bioscratch turns YAML front matter into a page header
author:
  - name: Ada Lovelace
  - name: Alan Turing
date: 2026-06-17
updated: 2026-06-17T14:22:00
status: published
draft: false
tags:
  - design
  - markdown
  - typography
aliases:
  - banner-anatomy
  - fm-showcase
categories: [editor, ux]
keywords: [frontmatter, yaml, wysiwyg]
description: >
  A folded-scalar description that wraps across several source lines but
  renders as one flowing sentence in the banner.
reading_time: 4
homepage: https://example.com/bioscratch
---

# The Anatomy of a Good Banner

This is the "ideal" case: a title, a subtitle/description, authors, dates, a
status badge, and several chip rows — exactly the cohesive, aesthetically
pleasing header the feature is meant to produce.

## Body still works

Everything below the banner is ordinary Markdown:

- **bold**, *italic*, `code`
- [a link](https://example.com)

```python
print("code blocks still render")
```

> And blockquotes, math $E = mc^2$, the works.
