"""Unit tests for document sniffing, extraction and filename sanitization.

These run without a database or network: the parsing layer is where malicious
input lands first, so it is tested in isolation.
"""

from __future__ import annotations

import io
import zipfile

import pytest
from zeus_contract_compliance.documents import (
    DocumentFormat,
    DocumentParseError,
    UnsupportedDocumentError,
    extract_document,
    normalize_text,
    safe_filename,
    sniff_format,
)


def _docx_bytes(paragraphs: list[str], table: list[list[str]] | None = None) -> bytes:
    import docx

    document = docx.Document()
    for text in paragraphs:
        document.add_paragraph(text)
    if table:
        t = document.add_table(rows=len(table), cols=len(table[0]))
        for r, row in enumerate(table):
            for c, cell in enumerate(row):
                t.cell(r, c).text = cell
    buf = io.BytesIO()
    document.save(buf)
    return buf.getvalue()


def _pdf_bytes(text: str) -> bytes:
    from pypdf import PdfWriter

    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


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
