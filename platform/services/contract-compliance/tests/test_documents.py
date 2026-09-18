"""Unit tests for document sniffing, extraction and filename sanitization.

These run without a database or network: the parsing layer is where malicious
input lands first, so it is tested in isolation.
"""

from __future__ import annotations

import io
import zipfile

import pytest
from zeus_contract_compliance.documents import (
    CHARS_PER_PAGE,
    DocumentFormat,
    DocumentParseError,
    UnsupportedDocumentError,
    count_pages,
    estimate_pages,
    extract_document,
    normalize_text,
    safe_filename,
    sniff_format,
)


def _docx_bytes(
    paragraphs: list[str],
    table: list[list[str]] | None = None,
    *,
    page_breaks: int = 0,
) -> bytes:
    import docx

    document = docx.Document()
    for text in paragraphs:
        document.add_paragraph(text)
    if table:
        t = document.add_table(rows=len(table), cols=len(table[0]))
        for r, row in enumerate(table):
            for c, cell in enumerate(row):
                t.cell(r, c).text = cell
    for _ in range(page_breaks):
        document.add_page_break()
    buf = io.BytesIO()
    document.save(buf)
    return buf.getvalue()


def _pdf_bytes(text: str) -> bytes:
    """A real PDF whose pages contain extractable text.

    ``PdfWriter.add_blank_page`` produces pages with no text at all, which
    ``extract_document`` rejects as needing OCR -- so it could never exercise
    extraction or the page count. Writing the file directly keeps the fixture
    honest without adding a rendering dependency; pypdf parses it exactly as it
    parses any other PDF.

    ``text`` is placed on a single page. Use :func:`_pdf_pages` for more.
    """
    return _pdf_pages([text])


def _pdf_pages(pages: list[str]) -> bytes:
    objs: list[bytes] = []

    def add(body: bytes) -> int:
        objs.append(body)
        return len(objs)

    font = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    kids: list[int] = []
    contents: list[tuple[int, int]] = []
    for body in pages:
        # Parentheses and backslashes delimit PDF strings and would corrupt the
        # object if passed through unescaped.
        escaped = body.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")
        stream = f"BT /F1 12 Tf 72 720 Td ({escaped}) Tj ET".encode()
        cid = add(b"<< /Length %d >>\nstream\n%s\nendstream" % (len(stream), stream))
        pid = add(b"")  # placeholder: the parent id is not known yet
        kids.append(pid)
        contents.append((pid, cid))

    pages_id = add(
        b"<< /Type /Pages /Count %d /Kids [%s] >>"
        % (len(pages), b" ".join(b"%d 0 R" % k for k in kids))
    )
    for pid, cid in contents:
        objs[pid - 1] = (
            b"<< /Type /Page /Parent %d 0 R /MediaBox [0 0 612 792] "
            b"/Resources << /Font << /F1 %d 0 R >> >> /Contents %d 0 R >>"
            % (pages_id, font, cid)
        )
    root = add(b"<< /Type /Catalog /Pages %d 0 R >>" % pages_id)

    out = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for n, obj in enumerate(objs, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n%s\nendobj\n" % (n, obj)
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
    for off in offsets[1:]:
        out += b"%010d 00000 n \n" % off
    out += b"trailer\n<< /Size %d /Root %d 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (
        len(objs) + 1,
        root,
        xref,
    )
    return bytes(out)


# --- sniffing ---------------------------------------------------------------


def test_sniffs_pdf_by_magic_bytes_not_extension():
    assert sniff_format(b"%PDF-1.7\n...", filename="notes.txt") is DocumentFormat.pdf


def test_sniffs_docx_container():
    data = _docx_bytes(["hello"])
    assert sniff_format(data, filename="anything.bin") is DocumentFormat.docx


def test_plain_zip_is_rejected():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("payload.exe", "MZ")
    with pytest.raises(UnsupportedDocumentError):
        sniff_format(buf.getvalue(), filename="contract.docx")


def test_binary_is_rejected_even_with_safe_extension():
    with pytest.raises(UnsupportedDocumentError):
        sniff_format(b"\x00\x01\x02\x03binary", filename="contract.txt")


def test_renamed_executable_does_not_select_pdf_parser():
    # ELF header renamed to .pdf: the content decides, and it is refused.
    with pytest.raises(UnsupportedDocumentError):
        sniff_format(b"\x7fELF\x02\x01\x01\x00" + b"\x00" * 64, filename="contract.pdf")


# --- extraction -------------------------------------------------------------


def test_extracts_plain_text_and_hashes_bytes():
    raw = b"Vendor shall deliver the Q1 report by March 31."
    result = extract_document(raw, filename="msa.txt")
    assert result.fmt is DocumentFormat.text
    assert "Q1 report" in result.text
    assert result.byte_size == len(raw)
    assert len(result.checksum) == 64  # sha256 hex
    assert result.truncated is False


def test_extracts_docx_paragraphs_and_table_cells():
    data = _docx_bytes(
        ["Vendor shall deliver the report."],
        table=[["Obligation", "Due"], ["Pay invoice", "2026-04-01"]],
    )
    result = extract_document(data, filename="msa.docx")
    assert "Vendor shall deliver the report." in result.text
    # Table content carries obligations often enough that it must be captured.
    assert "Pay invoice" in result.text


def test_empty_upload_rejected():
    with pytest.raises(UnsupportedDocumentError):
        extract_document(b"", filename="empty.txt")


def test_image_only_pdf_reports_ocr_guidance():
    # A blank page yields no text; the user gets an actionable message, not a
    # silent empty contract.
    with pytest.raises(DocumentParseError, match="OCR"):
        extract_document(_pdf_bytes(""), filename="scan.pdf")


def test_corrupt_pdf_is_a_parse_error_not_a_crash():
    with pytest.raises(DocumentParseError):
        extract_document(b"%PDF-1.4\ngarbage-not-a-pdf", filename="broken.pdf")


def test_extraction_is_truncated_at_the_ceiling():
    from zeus_contract_compliance.documents import MAX_EXTRACTED_CHARS

    raw = ("clause " * 100_000).encode()
    result = extract_document(raw, filename="huge.txt")
    assert result.truncated is True
    assert len(result.text) == MAX_EXTRACTED_CHARS


# --- the page rule (DEC-11) -------------------------------------------------
#
# Customers are billed per page, so these tests are the written form of the
# rule: a PDF page is a page, a DOCX page is a page where the author said so,
# and everything else is ceil(chars / 3000).


def test_pdf_pages_are_counted_not_estimated():
    doc = extract_document(_pdf_pages(["alpha", "beta", "gamma"]), filename="c.pdf")
    assert doc.pages == 3
    assert doc.page_basis == "counted"


def test_a_dense_pdf_is_billed_for_its_real_pages():
    """A 3-page contract is 3 pages however tightly it is set.

    Taking max(counted, estimate) for every format billed this document as 14
    pages, because 40k characters divided by 3000 says 14. The PDF stores the
    truth and the estimate must never override it.
    """
    dense = " ".join(f"clause{n}" for n in range(1500))  # ~13k chars per page
    doc = extract_document(_pdf_pages([dense, dense, dense]), filename="c.pdf")
    assert len(doc.text) > 10 * CHARS_PER_PAGE
    assert doc.pages == 3
    assert doc.page_basis == "counted"


def test_a_sparse_pdf_is_not_discounted_below_its_page_count():
    """Three nearly-empty pages are still three pages, not one."""
    doc = extract_document(_pdf_pages(["a", "b", "c"]), filename="c.pdf")
    assert doc.pages == 3


def test_docx_page_breaks_are_counted():
    data = _docx_bytes(["short"], page_breaks=3)
    doc = extract_document(data, filename="c.docx")
    assert doc.pages == 4  # three breaks means four pages
    assert doc.page_basis == "counted"


def test_docx_without_breaks_falls_back_to_the_estimate():
    """Word paginates invisibly, so most real documents have no breaks at all.

    Counting breaks alone would bill this as a single page.
    """
    data = _docx_bytes(["Obligation clause text. " * 400])  # ~9.6k chars
    doc = extract_document(data, filename="c.docx")
    assert doc.pages == 4
    assert doc.page_basis == "estimated"


def test_docx_break_count_does_not_undercut_the_estimate():
    """One manual break in a 40-page report does not make it two pages."""
    data = _docx_bytes(["Obligation clause text. " * 400], page_breaks=1)
    doc = extract_document(data, filename="c.docx")
    assert doc.pages == 4
    assert doc.page_basis == "estimated"


def test_plain_text_is_always_an_estimate():
    doc = extract_document(b"x" * (CHARS_PER_PAGE + 1), filename="c.txt")
    assert doc.pages == 2
    assert doc.page_basis == "estimated"


@pytest.mark.parametrize(
    ("chars", "expected"),
    [
        (1, 1),  # never zero: any document is at least one page
        (CHARS_PER_PAGE - 1, 1),
        (CHARS_PER_PAGE, 1),  # exactly full is still one page
        (CHARS_PER_PAGE + 1, 2),  # one character over rolls to the next
        (CHARS_PER_PAGE * 3, 3),
    ],
)
def test_estimate_rounds_up_at_the_boundary(chars: int, expected: int):
    assert estimate_pages("x" * chars) == expected


def test_estimate_never_returns_zero_for_empty_text():
    """Defensive: extraction rejects empty documents before this is reached,
    but a zero would silently make a document free."""
    assert estimate_pages("") == 1


def test_an_authoritative_count_of_zero_still_bills_one_page():
    assert count_pages("x", counted=0, authoritative=True) == (1, "counted")


def test_truncated_pdfs_bill_only_the_pages_actually_read():
    """Pages past the cap are neither extracted nor analysed, so charging for
    them would be charging for work deliberately not done."""
    from zeus_contract_compliance.documents import MAX_PDF_PAGES

    doc = extract_document(_pdf_pages(["clause text"] * (MAX_PDF_PAGES + 10)), filename="c.pdf")
    assert doc.pages == MAX_PDF_PAGES


# --- normalization ----------------------------------------------------------


def test_normalize_collapses_pdf_artifacts():
    messy = "Section\u00a0 1   \r\n\r\n\r\n\r\n  Pay\u00adment terms  "
    assert normalize_text(messy) == "Section 1\n\nPayment terms"


# --- filename safety --------------------------------------------------------


@pytest.mark.parametrize(
    ("given", "expected"),
    [
        ("../../etc/passwd", "passwd"),
        ("C:\\Users\\bob\\msa.pdf", "msa.pdf"),
        ("réport final.docx", "report_final.docx"),
        ('bad"name;rm -rf.txt', "bad_name_rm_-rf.txt"),
        ("", "document"),
        ("...", "document"),
    ],
)
def test_safe_filename_strips_paths_and_specials(given: str, expected: str):
    assert safe_filename(given) == expected


def test_safe_filename_is_length_bounded():
    assert len(safe_filename("a" * 500 + ".pdf")) <= 120
