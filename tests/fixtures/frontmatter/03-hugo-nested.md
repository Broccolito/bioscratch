---
title: Example Hugo Page
description: A page with deeply nested params and a cascade map.
date: 2024-02-02T04:14:54-08:00
lastmod: 2024-02-10T09:00:00-08:00
draft: false
weight: 10
tags:
  - hugo
  - static-site
categories: [tutorial]
aliases:
  - /old-url/
params:
  author: John Smith
  featured: true
  reading_time: 6
cascade:
  params:
    banner: /img/default.png
  target:
    path: /blog/**
    kind: page
---

# Hugo nested params

`params` and `cascade` are **nested maps** — the banner renders them as indented
sub-grids so structure stays legible. `draft: false` is a status badge,
`weight` is a plain number, and the date keys become date chips.
