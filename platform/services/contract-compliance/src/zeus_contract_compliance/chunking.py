"""Splitting long contracts into model-sized chunks.

Once the product accepts uploaded PDFs and DOCX files, contract bodies routinely
run to hundreds of thousands of characters — far beyond any model's context
window. Sending the whole body in one call fails hard, and silently truncating
it would drop obligations without telling anyone.

So we split. Two properties matter:

* **Split on structure, not character count.** Cutting mid-sentence can sever an
  obligation from its deadline. We prefer paragraph breaks, then sentence
  breaks, and only fall back to a hard cut when a single block is oversized.

* **Overlap consecutive chunks.** An obligation spanning a boundary would
  otherwise be seen only in fragments by both calls. The overlap means at least
  one chunk contains it whole; de-duplication downstream removes the double.
"""

from __future__ import annotations

import re

# Paragraph boundaries first, then sentence-ish boundaries.
_PARAGRAPH = re.compile(r"\n\s*\n")
_SENTENCE = re.compile(r"(?<=[.;:!?])\s+")


def chunk_text(
    text: str,
    *,
    max_chars: int = 24_000,
    overlap_chars: int = 1_500,
    max_chunks: int = 24,
) -> list[str]:
    """Split ``text`` into overlapping chunks no larger than ``max_chars``.

    Returns a single-element list when the text already fits, so callers can
    treat the short and long cases identically.
    """
    text = (text or "").strip()
    if not text:
        return []
    if len(text) <= max_chars:
        return [text]

    if overlap_chars >= max_chars:
        # A nonsensical config would otherwise loop forever.
        overlap_chars = max_chars // 4

    blocks = _split_to_blocks(text, max_chars)

    chunks: list[str] = []
    current = ""
    for block in blocks:
        if not current:
            current = block
            continue
        if len(current) + 2 + len(block) <= max_chars:
            current = f"{current}\n\n{block}"
            continue

        chunks.append(current)
        if len(chunks) >= max_chunks:
            return chunks
        # Carry the tail of the finished chunk into the next one, but never at
        # the cost of breaking the size limit: when a block is already at the
        # ceiling there is no room for overlap and the block wins.
        carry = _tail(current, overlap_chars)
        if carry and len(carry) + 2 + len(block) <= max_chars:
            current = f"{carry}\n\n{block}".strip()
        else:
            current = block

    if current:
        chunks.append(current)
    return chunks[:max_chunks]


def _split_to_blocks(text: str, max_chars: int) -> list[str]:
    """Break text into units that each fit within ``max_chars``."""
    blocks: list[str] = []
    for para in _PARAGRAPH.split(text):
        para = para.strip()
        if not para:
            continue
        if len(para) <= max_chars:
            blocks.append(para)
            continue
        blocks.extend(_split_long_block(para, max_chars))
    return blocks


def _split_long_block(block: str, max_chars: int) -> list[str]:
    """Handle a paragraph that alone exceeds the limit (tables, dense clauses)."""
    pieces: list[str] = []
    current = ""
    for sentence in _SENTENCE.split(block):
        if not sentence:
            continue
        if len(sentence) > max_chars:
            # No usable boundary left: hard-cut this run.
            if current:
                pieces.append(current)
                current = ""
            for i in range(0, len(sentence), max_chars):
                pieces.append(sentence[i : i + max_chars])
            continue
        if not current:
            current = sentence
        elif len(current) + 1 + len(sentence) <= max_chars:
            current = f"{current} {sentence}"
        else:
            pieces.append(current)
            current = sentence
    if current:
        pieces.append(current)
    return pieces


def _tail(text: str, overlap_chars: int) -> str:
    """Trailing slice of ``text``, snapped forward to a whitespace boundary."""
    if overlap_chars <= 0 or len(text) <= overlap_chars:
        return text
    tail = text[-overlap_chars:]
    space = tail.find(" ")
    return tail[space + 1 :] if space != -1 else tail
