import os
import unittest
from unittest.mock import patch

from engine.gemini import build_gemini_instances, get_gemini_status, parse_gemini_fields


class GeminiFieldParsingTests(unittest.TestCase):
    def test_parse_json_array_from_model_output(self):
        raw = '''```json
[
  {"label": "Name", "value": "John Doe"},
  {"label": "Date of Birth", "value": "01/01/1990"}
]
```'''
        fields = parse_gemini_fields(raw)
        self.assertEqual(fields[0]["label"], "Name")
        self.assertEqual(fields[0]["value"], "John Doe")
        self.assertEqual(fields[1]["label"], "Date of Birth")

    def test_parse_object_with_fields_key(self):
        raw = '{"fields": [{"label": "Email", "value": "user@example.com"}]}'
        fields = parse_gemini_fields(raw)
        self.assertEqual(fields[0]["label"], "Email")
        self.assertEqual(fields[0]["value"], "user@example.com")

    def test_build_gemini_instances_from_ocr_lines(self):
        ocr_cache = [(
            [{"text": "Jane Doe", "left": 10, "top": 20, "width": 90, "height": 20, "right": 100, "bottom": 40, "conf": 95}],
            [{"key": 0, "text": "Jane Doe", "left": 10, "top": 20, "right": 100, "bottom": 40, "word_idxs": [0]}],
            300,
            300,
        )]
        fields = [{"label": "Full Name", "value": "Jane Doe"}]

        instances = build_gemini_instances(fields, ocr_cache)

        self.assertEqual(len(instances), 1)
        self.assertEqual(instances[0]["display_label"], "Full Name")
        self.assertEqual(instances[0]["page"], 0)
        self.assertEqual(instances[0]["bbox"][0], 10)
        self.assertEqual(instances[0]["bbox"][2], 100)

    def test_get_gemini_status_without_key(self):
        with patch.dict(os.environ, {"GEMINI_API_KEY": "", "GOOGLE_API_KEY": ""}, clear=False):
            status = get_gemini_status()
        self.assertFalse(status["configured"])
        self.assertFalse(status["ok"])


if __name__ == "__main__":
    unittest.main()
