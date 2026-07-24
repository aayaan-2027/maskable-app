import json
import os
import re
from typing import List, Dict, Any


def parse_gemini_fields(raw: str) -> List[Dict[str, Any]]:
    """Parse Gemini JSON/text output into a generic list of field dicts."""
    if not raw:
        return []

    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)

    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return []

    if isinstance(data, list):
        return [
            {
                "label": item.get("label") or item.get("field") or item.get("name") or "",
                "value": item.get("value") or item.get("text") or item.get("content") or "",
            }
            for item in data
            if isinstance(item, dict)
        ]

    if isinstance(data, dict):
        fields = data.get("fields")
        if isinstance(fields, list):
            return [
                {
                    "label": item.get("label") or item.get("field") or item.get("name") or "",
                    "value": item.get("value") or item.get("text") or item.get("content") or "",
                }
                for item in fields
                if isinstance(item, dict)
            ]

    return []


def _normalize_label(label: str) -> str:
    return re.sub(r"\s+", " ", (label or "").strip())


def _looks_like_label(text: str) -> bool:
    cleaned = re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).strip()
    if not cleaned:
        return False
    if len(cleaned.split()) > 5:
        return False
    label_words = {
        "name", "full name", "date", "dob", "date of birth", "email", "phone",
        "mobile", "address", "nationality", "passport", "id", "number", "license",
        "company", "organization", "employer", "designation", "position", "salary",
        "account", "iban", "bank", "branch", "issue", "expiry", "reference",
        "customer", "contact", "gender", "signature", "amount", "code", "status",
        "اسم", "الاسم", "التاريخ", "تاريخ الميلاد", "البريد", "الايميل", "الهاتف",
        "الجوال", "العنوان", "الجنسية", "جواز السفر", "الرقم", "الشركة", "المؤسسة",
        "الوظيفة", "الراتب", "الحساب", "البنك", "الفرع", "المرجع", "العميل", "المبلغ"
    }
    return cleaned in label_words or any(word in label_words for word in cleaned.split())


def _extract_label_value_pairs(text: str) -> List[Dict[str, str]]:
    lines = [line.strip() for line in re.split(r"\n+", text or "") if line.strip()]
    pairs = []

    for line in lines:
        match = re.match(r"^([A-Za-z\u0600-\u06FF][A-Za-z\u0600-\u06FF .,/()&-]{0,60})\s*[:\-–—]\s*(.+)$", line)
        if match:
            label = _normalize_label(match.group(1))
            value = _normalize_label(match.group(2))
            if label and value:
                pairs.append({"label": label, "value": value})
                continue

        if _looks_like_label(line):
            pairs.append({"label": _normalize_label(line), "value": ""})

        if len(lines) > 1:
            for idx, line in enumerate(lines[:-1]):
                if _looks_like_label(line) and lines[idx + 1].strip():
                    pairs.append({"label": _normalize_label(line), "value": _normalize_label(lines[idx + 1])})

    unique = []
    seen = set()
    for item in pairs:
        key = (item["label"].lower(), item["value"].lower())
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)
    return unique


def extract_gemini_fields(ocr_text: str) -> List[Dict[str, Any]]:
    """Extract generic document fields from OCR text, using Gemini when configured."""
    if not ocr_text:
        return []

    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if api_key:
        try:
            import google.generativeai as genai

            genai.configure(api_key=api_key)
            model = genai.GenerativeModel("gemini-1.5-flash")
            prompt = (
                "Read the OCR text from a document and extract every field as a JSON array "
                "of objects with label and value. Keep labels generic and return only valid JSON."
            )
            response = model.generate_content(prompt + "\n\nOCR TEXT:\n" + ocr_text[:20000])
            fields = parse_gemini_fields(getattr(response, "text", "") or "")
            if fields:
                return fields
        except Exception:
            pass

    return _extract_label_value_pairs(ocr_text)


def get_gemini_status() -> Dict[str, Any]:
    """Return whether Gemini is configured and usable from the current environment."""
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        return {"configured": False, "ok": False, "message": "No Gemini API key is set."}

    try:
        import google.generativeai as genai
    except Exception as exc:
        return {"configured": True, "ok": False, "message": f"Gemini client import failed: {exc}"}

    try:
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-1.5-flash")
        response = model.generate_content("Reply with only JSON: {\"ok\": true}")
        text = (getattr(response, "text", "") or "").strip()
        return {
            "configured": True,
            "ok": "true" in text.lower() or "ok" in text.lower(),
            "message": "Gemini API responded successfully." if text else "Gemini API responded without text.",
        }
    except Exception as exc:
        return {"configured": True, "ok": False, "message": f"Gemini API call failed: {exc}"}


def build_gemini_instances(fields: List[Dict[str, Any]], ocr_cache: List[Any]) -> List[Dict[str, Any]]:
    """Create preview-selectable instances for Gemini-detected fields."""
    instances = []
    for page_idx, (words, lines, img_w, img_h) in enumerate(ocr_cache or []):
        if not words:
            continue

        for field in fields or []:
            label = _normalize_label(field.get("label") or "")
            value = _normalize_label(field.get("value") or "")
            if not label:
                continue

            bbox = None
            target_text = value or label
            if target_text:
                lower_target = target_text.lower()
                for word in words:
                    if lower_target in (word.get("text") or "").lower():
                        bbox = (
                            word.get("left", 0),
                            word.get("top", 0),
                            word.get("right", word.get("left", 0)),
                            word.get("bottom", word.get("top", 0)),
                        )
                        break

            if bbox is None and lines:
                first_line = lines[0]
                bbox = (
                    first_line.get("left", 0),
                    first_line.get("top", 0),
                    first_line.get("right", img_w),
                    first_line.get("bottom", img_h),
                )

            if bbox is None:
                bbox = (0, 0, img_w, img_h)

            instances.append({
                "id": f"gemini-{page_idx}-{len(instances)}",
                "field_type": "gemini_field",
                "display_label": label,
                "category": "generic",
                "value": value,
                "page": page_idx,
                "bbox": bbox,
            })

    return instances
