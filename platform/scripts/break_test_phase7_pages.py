#!/usr/bin/env python3
"""Break the page-quota code deliberately; assert the tests notice.

A test suite that has never failed has not been shown to work. Each patch
below is a mistake someone could plausibly make -- an off-by-one in a limit,
a check moved after the work it was meant to prevent, a default that turns
"unlimited" into "free tier". If a patch applies and the suite still passes,
that patch is a bug we could ship blind.

Run: PYTHONPATH=... python scripts/break_test_phase7_pages.py
"""

from __future__ import annotations

import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CC = ROOT / "services" / "contract-compliance"
SRC = CC / "src" / "zeus_contract_compliance"
TESTS = CC / "tests"

DOCUMENTS = SRC / "documents.py"
INGESTION = SRC / "ingestion.py"
ROUTERS = SRC / "routers.py"


@dataclass(frozen=True)
class Patch:
    name: str
    why: str
    path: Path
    old: str
    new: str


PATCHES: list[Patch] = [
    # --- the page rule (DEC-11) ---------------------------------------------
    Patch(
        "pdf count overridden by the estimate",
        "billed a dense 3-page PDF as 14 pages",
        DOCUMENTS,
        '    if authoritative:\n        return max(1, counted), "counted"',
        '    if authoritative and False:\n        return max(1, counted), "counted"',
    ),
    Patch(
        "docx break count allowed to undercut the estimate",
        "bills a 40-page report with one manual break as 2 pages",
        DOCUMENTS,
        (
            '    if counted >= estimate:\n'
            '        return max(1, counted), "counted"\n'
            '    return estimate, "estimated"'
        ),
        (
            '    if counted >= estimate:\n'
            '        return max(1, counted), "counted"\n'
            '    return max(1, counted), "counted"'
        ),
    ),
    Patch(
        "estimate rounds down",
        "3001 characters becomes 1 page; everything under-bills",
        DOCUMENTS,
        "    return max(1, -(-len(text) // CHARS_PER_PAGE))",
        "    return max(1, len(text) // CHARS_PER_PAGE)",
    ),
    Patch(
        "estimate may return zero",
        "a zero-page document is free and violates the CHECK constraint",
        DOCUMENTS,
        "    return max(1, -(-len(text) // CHARS_PER_PAGE))",
        "    return -(-len(text) // CHARS_PER_PAGE)",
    ),
    Patch(
        "pages past the PDF cap are billed",
        "charges for pages that were never extracted or analysed",
        DOCUMENTS,
        (
            "        pages = reader.pages[:MAX_PDF_PAGES]\n"
            '        return "\\n\\n".join((page.extract_text() or "") for page in pages), '
            "len(pages)"
        ),
        (
            "        pages = reader.pages[:MAX_PDF_PAGES]\n"
            '        return "\\n\\n".join((page.extract_text() or "") for page in pages), '
            "len(reader.pages)"
        ),
    ),
    # --- quota enforcement ---------------------------------------------------
    Patch(
        "monthly pages ignores the document being uploaded",
        "a 10-page file at 95/100 is accepted, landing the tenant at 105",
        INGESTION,
        "            if used_pages + extracted.pages > quota.pages_per_month:",
        "            if used_pages > quota.pages_per_month:",
    ),
    Patch(
        "per-document cap off by one",
        "a 25-page file is refused on a 25-page plan",
        INGESTION,
        (
            "        if quota.pages_per_document is not None and "
            "extracted.pages > quota.pages_per_document:"
        ),
        (
            "        if quota.pages_per_document is not None and "
            "extracted.pages >= quota.pages_per_document:"
        ),
    ),
    Patch(
        "document count checked after extraction",
        "a tenant already at their cap still pays for the parse",
        INGESTION,
        "        if quota.documents_per_month is not None:",
        "        if quota.documents_per_month is not None and False:",
    ),
    Patch(
        "quota refusal happens after the bytes are stored",
        "a refused upload leaves orphaned objects nobody will ever collect",
        INGESTION,
        (
            "        if quota.pages_per_document is not None and "
            "extracted.pages > quota.pages_per_document:\n"
            "            raise QuotaExceededError("
        ),
        (
            "        if False and quota.pages_per_document is not None:\n"
            "            raise QuotaExceededError("
        ),
    ),
    Patch(
        "page count not persisted",
        "the number cannot be billed against if it never reaches the row",
        INGESTION,
        "                pages=extracted.pages,",
        "                pages=1,",
    ),
    Patch(
        "failed insert leaves the object behind",
        "storage fills with bytes no row points at",
        INGESTION,
        "                await self._storage.delete(self._bucket, key)",
        "                pass",
    ),
    # --- DEC-10 / D22 --------------------------------------------------------
    Patch(
        "a missing limit becomes a default instead of unlimited",
        "this is D22: enterprise plans get the free-tier allowance",
        ROUTERS,
        "    value = limits.get(key)\n    return None if value is None else int(value)",
        "    value = limits.get(key)\n    return 25 if value is None else int(value)",
    ),
]


def run_tests() -> bool:
    proc = subprocess.run(
        [
            sys.executable,
            "-m",
            "pytest",
            str(TESTS),
            "-q",
            "-x",
            "--no-header",
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    return proc.returncode == 0


def main() -> int:
    if not run_tests():
        print("FAIL: the suite is already red. Fix that before break-testing.")
        return 1

    missed: list[Patch] = []
    for patch in PATCHES:
        original = patch.path.read_text()
        if patch.old not in original:
            print(f"  STALE   {patch.name}")
            print(f"          anchor not found in {patch.path.name} -- patch needs updating")
            missed.append(patch)
            continue
        try:
            patch.path.write_text(original.replace(patch.old, patch.new, 1))
            caught = not run_tests()
        finally:
            patch.path.write_text(original)

        if caught:
            print(f"  caught  {patch.name}")
        else:
            print(f"  MISSED  {patch.name}")
            print(f"          would have shipped: {patch.why}")
            missed.append(patch)

    total = len(PATCHES)
    print(f"\n{total - len(missed)}/{total} caught")
    return 1 if missed else 0


if __name__ == "__main__":
    raise SystemExit(main())
