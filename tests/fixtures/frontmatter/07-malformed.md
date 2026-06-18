---
title: My: Unquoted Colon Breaks This
date: 2024-13-45
tags: [unclosed, list
description: "mismatched 'quotes"
draft: yes
time: 22:30
percentage: 50%
created: <% tp.file.creation_date() %>
---

# Malformed but common

Every line here is a real-world frontmatter mistake: an unquoted colon, an
impossible date, an unclosed flow list, mismatched quotes, a `yes` boolean, a
bare time, an unquoted `%`, and a Templater tag. The banner must **fail soft** —
fall back to the line parser and render a partial banner (flagged "unparsed")
rather than throwing.
