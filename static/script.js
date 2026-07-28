(() => {
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("file-input");
  const fileNameEl = document.getElementById("file-name");
  const uploadStatus = document.getElementById("upload-status");

  const stepUpload = document.getElementById("step-upload");
  const stepReview = document.getElementById("step-review");
  const reviewSubhead = document.getElementById("review-subhead");
  const previewContainer = document.getElementById("preview-container");
  const maskBtn = document.getElementById("mask-btn");
  const backBtn = document.getElementById("back-btn");
  const undoBtn = document.getElementById("undo-box-btn");
  const redoBtn = document.getElementById("redo-box-btn");
  const maskStatus = document.getElementById("mask-status");

  let currentJobId = null;

  // ---------- dropzone ----------
  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.classList.add("dropzone--drag"); });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dropzone--drag"));
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("dropzone--drag");
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener("change", () => {
    if (fileInput.files.length) handleFile(fileInput.files[0]);
  });

  function handleFile(file) {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setStatus(uploadStatus, "Only PDF files are supported.", "error");
      return;
    }
    fileNameEl.textContent = file.name;
    extractFields(file);
  }

  function setStatus(el, message, kind) {
    el.textContent = message || "";
    el.className = "status" + (kind ? ` status--${kind}` : "");
  }

  // ---------- step 1: extract ----------
  async function extractFields(file) {
    setStatus(uploadStatus, "Processing PDF preview…", "loading");
    dropzone.classList.add("dropzone--busy");

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/extract", { method: "POST", body: formData });
      const rawText = await res.text();
      let data = {};

      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        data = { error: rawText || "Something went wrong reading that PDF." };
      }

      if (!res.ok) {
        setStatus(uploadStatus, data.error || "Something went wrong reading that PDF.", "error");
        dropzone.classList.remove("dropzone--busy");
        return;
      }
      currentJobId = data.job_id;
      if (window._previewSelect?.clearCustomBboxes) {
        window._previewSelect.clearCustomBboxes();
      }
      updateUndoRedoButtons();
      renderReviewIntro(data);
      renderPreview(data);
      setStatus(uploadStatus, "", null);
      dropzone.classList.remove("dropzone--busy");
      stepUpload.hidden = true;
      stepReview.hidden = false;
    } catch (err) {
      setStatus(uploadStatus, "Network error — please try again.", "error");
      dropzone.classList.remove("dropzone--busy");
    }
  }

  // ---------- step 2: review intro ----------
  function renderReviewIntro(data) {
    reviewSubhead.textContent = data.num_pages
      ? `${data.num_pages} page(s) scanned. Draw a box on the preview to create a custom redaction.`
      : "Draw a box on the preview to create a custom redaction.";
  }

  function updateUndoRedoButtons() {
    const hasItems = (window._previewSelect?.getCustomBboxes?.() || []).length > 0;
    if (undoBtn) undoBtn.disabled = !hasItems;
    if (redoBtn) redoBtn.disabled = !((window.customBboxesRedo || []).length > 0);
  }

  // ---------- preview rendering and interaction ----------
  function renderPreview(data) {
    if (!previewContainer) return;
    previewContainer.innerHTML = "";
    const previews = data.page_previews || [];
    if (!previews.length) return;

    for (let pageIndex = 0; pageIndex < previews.length; pageIndex++) {
      const src = previews[pageIndex];
      const pageEl = document.createElement("div");
      pageEl.className = "preview-page";
      pageEl.dataset.page = pageIndex;
      const img = document.createElement("img");
      img.className = "preview-image";
      img.src = src;
      pageEl.appendChild(img);
      previewContainer.appendChild(pageEl);
    }
  }

  // ---------- step 3: mask & download ----------
  undoBtn?.addEventListener("click", () => {
    if (window._previewSelect?.undo?.()) {
      updateUndoRedoButtons();
    }
  });

  redoBtn?.addEventListener("click", () => {
    if (window._previewSelect?.redo?.()) {
      updateUndoRedoButtons();
    }
  });

  window.addEventListener("preview:boxes-changed", updateUndoRedoButtons);

  backBtn.addEventListener("click", () => {
    stepReview.hidden = true;
    stepUpload.hidden = false;
    fileInput.value = "";
    fileNameEl.textContent = "";
    setStatus(maskStatus, "", null);
    currentJobId = null;
    if (window._previewSelect?.clearCustomBboxes) {
      window._previewSelect.clearCustomBboxes();
    }
    if (previewContainer) {
      previewContainer.innerHTML = "";
    }
    updateUndoRedoButtons();
  });

  async function runMaskAction(source) {
    if (!currentJobId) return;
    const customBboxes = window._previewSelect?.getCustomBboxes?.() || [];

    if (customBboxes.length === 0) {
      setStatus(maskStatus, "Draw a box to mask before downloading.", "error");
      return;
    }

    setStatus(maskStatus, "Applying redactions…", "loading");
    maskBtn.disabled = true;

    try {
      const res = await fetch("/mask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id: currentJobId,
          custom_bboxes: customBboxes,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setStatus(maskStatus, data.error || "Masking failed.", "error");
        maskBtn.disabled = false;
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "masked_output.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setStatus(maskStatus, "Done — your masked PDF has downloaded.", "success");
      maskBtn.disabled = false;
    } catch (err) {
      setStatus(maskStatus, "Network error — please try again.", "error");
      maskBtn.disabled = false;
    }
  }

  maskBtn.addEventListener("click", () => runMaskAction("mask"));
})();
