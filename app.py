import base64
import io
import os
import uuid

from flask import Flask, request, render_template, send_file, jsonify, after_this_request

from engine import pipeline, jobs, ner, ocr, gemini

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
OUTPUT_DIR = os.path.join(BASE_DIR, "outputs")
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(os.path.join(BASE_DIR, "jobs"), exist_ok=True)

MAX_CONTENT_LENGTH = 25 * 1024 * 1024  # 25 MB upload limit

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_CONTENT_LENGTH


def _encode_page_preview(image, width=900):
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def build_document_groups(instances):
    return []


def resolve_selected_instances(all_instances, selected_group_ids, selected_instance_ids, selected_boxes):
    selected_instances = [
        inst for inst in all_instances
        if (f"{inst['category']}::{inst['field_type']}::{inst['display_label']}" in selected_group_ids
            or inst["id"] in selected_instance_ids)
    ]

    for idx, custom in enumerate(selected_boxes or []):
        if not isinstance(custom, dict):
            continue
        page = custom.get("page")
        bbox = custom.get("bbox")
        if not isinstance(page, int) or not isinstance(bbox, list) or len(bbox) != 4:
            continue
        selected_instances.append({
            "id": f"preview-{idx}",
            "page": page,
            "bbox": tuple(bbox),
        })

    return selected_instances


@app.route("/")
def index():
    return render_template("index.html", ner_active=ner.ner_available(),
                            ocr_languages=ocr.active_ocr_langs())


@app.route("/extract", methods=["POST"])
def extract():
    jobs.cleanup_stale_jobs(BASE_DIR)

    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400
    file = request.files["file"]
    if file.filename == "":
        return jsonify({"error": "No file selected"}), 400
    if not file.filename.lower().endswith(".pdf"):
        return jsonify({"error": "Only PDF files are supported"}), 400

    job_id = uuid.uuid4().hex
    input_path = os.path.join(UPLOAD_DIR, f"{job_id}.pdf")
    file.save(input_path)

    try:
        page_images, instances, ocr_cache = pipeline.extract_fields(input_path)
    except Exception as exc:
        if os.path.exists(input_path):
            os.remove(input_path)
        return jsonify({"error": f"Could not read this PDF: {exc}"}), 500

    if os.path.exists(input_path):
        os.remove(input_path)  # never keep the original once it's been OCR'd

    jobs.create_job(BASE_DIR, job_id)
    for idx, img in enumerate(page_images):
        jobs.save_page_image(BASE_DIR, job_id, idx, img)
    jobs.save_ocr_data(BASE_DIR, job_id, ocr_cache)
    jobs.save_instances(BASE_DIR, job_id, instances, len(page_images))

    groups = pipeline.group_for_ui(instances)
    documents = build_document_groups(instances)
    # small PNG previews for frontend overlay; encoded as data URLs
    try:
        page_previews = [_encode_page_preview(img, width=900) for img in page_images]
    except Exception:
        page_previews = []

    if not groups:
        return jsonify({
            "job_id": job_id,
            "num_pages": len(page_images),
            "groups": [],
            "documents": documents,
            "page_previews": page_previews,
            "ner_active": ner.ner_available(),
            "ocr_languages": ocr.active_ocr_langs(),
            "message": "No standard fields were detected automatically. "
                       "You can still describe what to mask in plain text below.",
        })

    return jsonify({
        "job_id": job_id,
        "num_pages": len(page_images),
        "groups": groups,
        "documents": documents,
        "page_previews": page_previews,
        "ner_active": ner.ner_available(),
        "ocr_languages": ocr.active_ocr_langs(),
    })


@app.route("/mask", methods=["POST"])
def mask():
    body = request.get_json(silent=True) or {}
    job_id = body.get("job_id")
    selected_group_ids = set(body.get("group_ids", []))
    selected_instance_ids = set(body.get("instance_ids", []))
    selected_boxes = body.get("selected_boxes", []) or []
    instructions = (body.get("instructions") or "").strip()
    custom_bboxes = body.get("custom_bboxes", []) or []

    if not job_id:
        return jsonify({"error": "Missing job_id — please re-upload the document"}), 400

    job_data = jobs.load_job_data(BASE_DIR, job_id)
    if job_data is None:
        return jsonify({"error": "This session has expired — please re-upload the document"}), 400

    all_instances = job_data["instances"]
    num_pages = job_data["num_pages"]

    # Re-derive each instance's group_id the same way group_for_ui does,
    # so a selected checkbox maps back to every matching instance.
    selected_instances = resolve_selected_instances(
        all_instances, selected_group_ids, selected_instance_ids, selected_boxes
    )

    if instructions:
        ocr_cache = jobs.load_ocr_data(BASE_DIR, job_id)
        if ocr_cache:
            selected_instances += pipeline.run_custom_search(ocr_cache, instructions)

    for idx, custom in enumerate(custom_bboxes):
        if not isinstance(custom, dict):
            continue
        page = custom.get("page")
        bbox = custom.get("bbox")
        if not isinstance(page, int) or not isinstance(bbox, list) or len(bbox) != 4:
            continue
        selected_instances.append({
            "id": f"custom-{idx}",
            "page": page,
            "bbox": tuple(bbox),
        })

    if not selected_instances:
        return jsonify({
            "error": "Select at least one field, draw a box, or describe what to mask",
            "debug": {
                "group_ids": list(selected_group_ids),
                "instance_ids": list(selected_instance_ids),
                "selected_boxes": selected_boxes,
            },
        }), 400

    seen = {}
    unique_selected = []
    for inst in selected_instances:
        inst_id = inst.get("id")
        if inst_id is None:
            unique_selected.append(inst)
            continue
        if inst_id not in seen:
            seen[inst_id] = True
            unique_selected.append(inst)
    selected_instances = unique_selected

    try:
        page_images = [jobs.load_page_image(BASE_DIR, job_id, i) for i in range(num_pages)]
    except Exception as exc:
        return jsonify({"error": f"Session data missing: {exc}"}), 400

    output_path = os.path.join(OUTPUT_DIR, f"{job_id}_masked.pdf")
    try:
        pipeline.render_masked_pdf(page_images, selected_instances, output_path)
    except Exception as exc:
        return jsonify({"error": f"Masking failed: {exc}"}), 500
    finally:
        jobs.cleanup_job(BASE_DIR, job_id)

    @after_this_request
    def cleanup(response):
        try:
            if os.path.exists(output_path):
                os.remove(output_path)
        except Exception:
            pass
        return response

    return send_file(
        output_path, as_attachment=True,
        download_name="masked_output.pdf", mimetype="application/pdf",
    )


@app.route("/health")
def health():
    return jsonify({"status": "ok", "ner_active": ner.ner_available(),
                     "ocr_languages": ocr.active_ocr_langs(),
                     "gemini": gemini.get_gemini_status()})


@app.route("/gemini-test")
def gemini_test():
    return jsonify(gemini.get_gemini_status())


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port, debug=False)
