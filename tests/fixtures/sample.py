"""
Bioscratch Python fixture — tests Python syntax highlighting.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from typing import Optional


LARGE_FILE_THRESHOLD = 1_000_000  # bytes


@dataclass
class Document:
    path: Optional[str] = None
    content: str = ""
    dirty: bool = False
    tags: list[str] = field(default_factory=list)

    @property
    def filename(self) -> str:
        if self.path is None:
            return "Untitled"
        return os.path.basename(self.path)

    def word_count(self) -> int:
        return len(re.findall(r"\w+", self.content))

    def save(self) -> None:
        if self.path is None:
            raise ValueError("No path set — use save_as() instead")
        with open(self.path, "w", encoding="utf-8") as fh:
            fh.write(self.content)
        self.dirty = False

    def save_as(self, path: str) -> None:
        self.path = path
        self.save()


def load_document(path: str) -> Document:
    """Load a document from disk, warning if it is large."""
    size = os.path.getsize(path)
    if size > LARGE_FILE_THRESHOLD:
        answer = input(f"{path!r} is {size / 1e6:.1f} MB. Open anyway? [y/N] ")
        if answer.strip().lower() != "y":
            raise SystemExit("Aborted.")
    with open(path, encoding="utf-8") as fh:
        content = fh.read()
    return Document(path=path, content=content)


if __name__ == "__main__":
    doc = load_document("README.md")
    print(f"Loaded '{doc.filename}' — {doc.word_count()} words")
