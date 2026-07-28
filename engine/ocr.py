"""
engine/ocr.py
Minimal PDF page conversion helper for manual redaction.
"""

from pdf2image import convert_from_path

DPI = 100


def pdf_to_images(pdf_path: str, dpi: int = DPI):
    """Returns a list of PIL Images, one per page."""
    return convert_from_path(pdf_path, dpi=dpi, thread_count=1)
