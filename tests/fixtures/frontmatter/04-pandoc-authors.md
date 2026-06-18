---
title: A Study of Closing Fences in YAML Metadata
author:
  - name: Author One
    affiliation: University of Somewhere
    email: one@somewhere.edu
  - name: Author Two
    affiliation: University of Nowhere
    email: two@nowhere.edu
date: 2026-06-17
abstract: |
  This is the abstract.

  It consists of two paragraphs and is written as a
  literal block scalar so the line breaks are preserved.
keywords: [yaml, metadata, pandoc]
classoption:
  - 11pt
  - twocolumn
...

# Pandoc metadata

Two things make this tricky and worth testing:

1. `author` is a **list of objects** (`name` / `affiliation` / `email`) — the
   banner shows each author, and the object fields nest underneath.
2. The block ends with the Pandoc **`...` closing fence** instead of `---`.
3. `abstract` is a multi-line literal block scalar.
