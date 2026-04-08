# Mixed Content Document

This document combines all supported content types.

## Text Formatting

You can write **bold**, *italic*, ~~strikethrough~~, and `inline code`.
Links look like [this](https://example.com "Optional title").

## Code and Math Together

The time complexity of bubble sort is $O(n^2)$, while merge sort is $O(n \log n)$.

Here's a sorting implementation:

```python
def merge_sort(arr):
    if len(arr) <= 1:
        return arr
    mid = len(arr) // 2
    left = merge_sort(arr[:mid])
    right = merge_sort(arr[mid:])
    return merge(left, right)
```

The recurrence relation is:

$T(n) = 2T\left(\frac{n}{2}\right) + O(n)$

## Tables with Formatting

| Algorithm   | Time Complexity | Space       |
| ----------- | --------------- | ----------- |
| Bubble Sort | $O(n^2)$        | $O(1)$      |
| Merge Sort  | $O(n \log n)$   | $O(n)$      |
| Quick Sort  | $O(n \log n)$   | $O(\log n)$ |

## Task List

- [x] Implement the schema

- [x] Write markdown parser

- [x] Add KaTeX support

- [ ] Add PDF export

- [ ] Write documentation

## Nested Lists

- Category A

- Sub-item A1

- Sub-item A2

- Deep item

- Category B

- Sub-item B1

> **Note:** This document is for testing purposes only.
> It demonstrates the full range of Jottingdown's capabilities.
>
>
---

*End of mixed content document.*
