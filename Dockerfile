# ── Base image ──
FROM python:3.11-slim

# tesseract-ocr     : OCR engine used by pytesseract
# tesseract-ocr-urd : Urdu script recognition (GCC/expat-labor documents)
# tesseract-ocr-ara : Arabic script recognition (GCC official documents)
# poppler-utils     : used by pdf2image to convert PDF pages to images
RUN apt-get update && apt-get install -y --no-install-recommends \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Render (and most PaaS platforms) inject $PORT at runtime.
ENV PORT=8080
EXPOSE 8080

CMD gunicorn app:app --bind 0.0.0.0:$PORT --workers 1 --timeout 600
