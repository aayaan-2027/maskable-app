"""
engine/masking.py
Draws the actual redaction. Fills selected bounding boxes with a solid black
rectangle to ensure original underlying pixels are completely overwritten.
"""

from PIL import ImageDraw

FILL_COLOR = (0, 0, 0)  # solid black box


def draw_redaction(draw: ImageDraw.ImageDraw, bbox):
    left, top, right, bottom = bbox
    w, h = right - left, bottom - top
    if w <= 0 or h <= 0:
        return
    draw.rectangle(bbox, fill=FILL_COLOR)


def apply_redactions(page_image, instances):
    """instances: list of {"bbox": (l,t,r,b), ...} for THIS page only."""
    masked = page_image.copy()
    draw = ImageDraw.Draw(masked)
    for inst in instances:
        draw_redaction(draw, inst["bbox"])
    return masked