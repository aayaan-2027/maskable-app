"""
engine/pipeline.py
Minimal PDF masking pipeline for manual box redaction.
"""

from .masking import apply_redactions
from .ocr import DPI


def render_masked_pdf(page_images, instances, output_path):
    by_page = {}
    for inst in instances:
        by_page.setdefault(inst["page"], []).append(inst)

    masked_pages = []
    for idx, image in enumerate(page_images):
        page_instances = by_page.get(idx, [])
        masked_pages.append(apply_redactions(image, page_instances) if page_instances else image.copy())

    first = masked_pages[0].convert("RGB")
    rest = [p.convert("RGB") for p in masked_pages[1:]]
    first.save(output_path, save_all=True, append_images=rest, resolution=DPI)
