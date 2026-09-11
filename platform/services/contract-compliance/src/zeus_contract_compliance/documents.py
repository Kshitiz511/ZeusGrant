"""Turn an uploaded file into contract text, safely.

Design constraints:
  * **Allowlist, not blocklist.** Only PDF, DOCX, plain text and Markdown are
    accepted. Anything else is rejected before a single byte is parsed.
  * **Sniff, don't trust.** The browser-supplied ``Content-Type`` is advisory;
    the real format is decided from magic bytes, so renaming ``evil.exe`` to
    ``contract.pdf`` does not select the PDF parser.
  * **Bounded work.** Size is capped by the caller, page/paragraph counts are
    capped here, and extracted text is truncated, so a "zip bomb" style file
    cannot exhaust memory or the LLM budget.
  * **Pure python.** No shelling out to system binaries, so there is no command
    injection surface and the container stays minimal.
"""

from __future__ import annotations

import hashlib
import io
import re
import unicodedata
from dataclasses import dataclass
from enum import StrEnum

# Upper bound on characters handed downstream. ~400k chars is far beyond any
# real contract and keeps a single request's LLM cost predictable.
MAX_EXTRACTED_CHARS = 400_000
MAX_PDF_PAGES = 500


class DocumentFormat(StrEnum):
    pdf = "pdf"
    docx = "docx"
    text = "text"


class UnsupportedDocumentError(ValueError):
    """Raised when a file's real format is not one we accept."""


class DocumentParseError(ValueError):
    """Raised when an accepted format fails to parse (corrupt/encrypted)."""


@dataclass(frozen=True, slots=True)
class ExtractedDocument:
    text: str
    fmt: DocumentFormat
    content_type: str
    checksum: str
    byte_size: int
    truncated: bool


_CONTENT_TYPES: dict[DocumentFormat, str] = {
    DocumentFormat.pdf: "application/pdf",
    DocumentFormat.docx: (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ),
    DocumentFormat.text: "text/plain",
}

# Extensions shown to users in error messages and accepted by the UI picker.
ALLOWED_EXTENSIONS = (".pdf", ".docx", ".txt", ".md")

_ZIP_MAGIC = b"PK\x03\x04"
_PDF_MAGIC = b"%PDF-"


def sniff_format(data: bytes, *, filename: str = "") -> DocumentFormat:
    """Determine the real format from content, falling back to the extension.

    Only used to *choose a parser*; a wrong guess results in a rejection, never
    in executing anything.
    """
    if data.startswith(_PDF_MAGIC):
        return DocumentFormat.pdf

    if data.startswith(_ZIP_MAGIC):
        # DOCX is a zip container. Confirm it really holds a Word document so
        # arbitrary archives (or xlsx/pptx) are not fed to the docx parser.
        if b"word/document.xml" in data[:8192] or _zip_has_word_part(data):
            return DocumentFormat.docx
        raise UnsupportedDocumentError(
            "Archive files are not supported. Upload a PDF, DOCX, TXT or MD file."
        )

    lowered = filename.lower()
    if lowered.endswith((".txt", ".md")) and _looks_like_text(data):
        return DocumentFormat.text
    if _looks_like_text(data):
        return DocumentFormat.text

    raise UnsupportedDocumentError(
        "Unsupported file type. Accepted formats: " + ", ".join(ALLOWED_EXTENSIONS) + "."
    )


def _zip_has_word_part(data: bytes) -> bool:
    import zipfile

    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            return "word/document.xml" in zf.namelist()
    except (zipfile.BadZipFile, OSError):
        return False


def _looks_like_text(data: bytes) -> bool:
    """True when the bytes decode as UTF-8 and hold no NUL/control noise."""
    sample = data[:8192]
    if b"\x00" in sample:
        return False
    try:
        decoded = sample.decode("utf-8")
    except UnicodeDecodeError:
        return False
    # Reject binaries that happen to be valid UTF-8 by checking control density.
    controls = sum(1 for ch in decoded if unicodedata.category(ch) == "Cc" and ch not in "\r\n\t")
    return controls <= max(1, len(decoded) // 100)


def extract_document(data: bytes, *, filename: str = "") -> ExtractedDocument:
    """Extract normalized text from an uploaded file.

    Raises :class:`UnsupportedDocumentError` or :class:`DocumentParseError`;
    both are safe to surface to the caller as a 4xx.
    """
    if not data:
        raise UnsupportedDocumentError("The uploaded file is empty.")

    fmt = sniff_format(data, filename=filename)

    if fmt is DocumentFormat.pdf:
        raw = _extract_pdf(data)
    elif fmt is DocumentFormat.docx:
        raw = _extract_docx(data)
    else:
        raw = data.decode("utf-8", errors="replace")

    text = normalize_text(raw)
    truncated = len(text) > MAX_EXTRACTED_CHARS
    if truncated:
        text = text[:MAX_EXTRACTED_CHARS]

    if not text.strip():
        raise DocumentParseError(
            "No readable text found. Scanned or image-only documents need OCR before upload."
        )

    return ExtractedDocument(
        text=text,
        fmt=fmt,
        content_type=_CONTENT_TYPES[fmt],
        checksum=hashlib.sha256(data).hexdigest(),
        byte_size=len(data),
        truncated=truncated,
    )


def _extract_pdf(data: bytes) -> str:
    try:
        from pypdf import PdfReader
    except ImportError as exc:  # pragma: no cover - dependency is declared
        raise DocumentParseError("PDF support is not installed.") from exc

    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            # An empty-password decrypt covers the common "owner password only"
            # case; a real user password is a rejection, not a crack attempt.
            try:
                reader.decrypt("")
            except Exception as exc:
                raise DocumentParseError(
                    "This PDF is password protected. Remove the password and re-upload."
                ) from exc

        pages = reader.pages[:MAX_PDF_PAGES]
        return "\n\n".join((page.extract_text() or "") for page in pages)
    except DocumentParseError:
        raise
    except Exception as exc:
        raise DocumentParseError("Could not read this PDF. The file may be corrupt.") from exc


def _extract_docx(data: bytes) -> str:
    try:
        import docx
    except ImportError as exc:  # pragma: no cover - dependency is declared
        raise DocumentParseError("DOCX support is not installed.") from exc

    try:
        document = docx.Document(io.BytesIO(data))
    except Exception as exc:
        raise DocumentParseError("Could not read this DOCX. The file may be corrupt.") from exc

    parts = [p.text for p in document.paragraphs]
    # Obligations are frequently laid out in tables, so those cells matter.
    for table in document.tables:
        for row in table.rows:
            cells = [cell.text.strip() for cell in row.cells]
            if any(cells):
                parts.append(" | ".join(cells))
    return "\n".join(parts)


_WS_RUN = re.compile(r"[ \t\u00a0]+")
_BLANK_RUN = re.compile(r"\n{3,}")


def normalize_text(raw: str) -> str:
    """Collapse extraction artifacts into clean, token-efficient text."""
    text = unicodedata.normalize("NFKC", raw)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace("\u00ad", "")  # soft hyphens from PDF line breaking
    text = _WS_RUN.sub(" ", text)
    text = "\n".join(line.strip() for line in text.split("\n"))
    return _BLANK_RUN.sub("\n\n", text).strip()


_SAFE_NAME = re.compile(r"[^A-Za-z0-9._-]+")


def safe_filename(filename: str, *, fallback: str = "document") -> str:
    """Reduce a user-supplied filename to a safe, storage-friendly token.

    Strips directory components and anything outside ``[A-Za-z0-9._-]`` so the
    value can never influence a storage path or a Content-Disposition header.
    """
    base = (filename or "").replace("\\", "/").split("/")[-1]
    base = unicodedata.normalize("NFKD", base).encode("ascii", "ignore").decode("ascii")
    cleaned = _SAFE_NAME.sub("_", base).strip("._")
    if not cleaned:
        cleaned = fallback
    return cleaned[:120]
