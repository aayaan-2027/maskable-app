(() => {
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("file-input");
  const fileNameEl = document.getElementById("file-name");
  const uploadStatus = document.getElementById("upload-status");

  const stepUpload = document.getElementById("step-upload");
  const stepReview = document.getElementById("step-review");
  const reviewSubhead = document.getElementById("review-subhead");
  const instructionsEl = document.getElementById("instructions");
  const previewContainer = document.getElementById("preview-container");
  const maskBtn = document.getElementById("mask-btn");
  const backBtn = document.getElementById("back-btn");
  const undoBtn = document.getElementById("undo-box-btn");
  const redoBtn = document.getElementById("redo-box-btn");
  const maskStatus = document.getElementById("mask-status");

  let currentJobId = null;

  // Keep the review list neutral by default; the preview is the primary
  // selection surface for masking, so no fields are preselected.
  const DEFAULT_ON_CATEGORIES = new Set();

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
    setStatus(uploadStatus, "Scanning document and detecting fields…", "loading");
    dropzone.classList.add("dropzone--busy");

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/extract", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        setStatus(uploadStatus, data.error || "Something went wrong reading that PDF.", "error");
        dropzone.classList.remove("dropzone--busy");
        return;
      }
      currentJobId = data.job_id;
      selectedInstanceIds.clear();
      if (window._previewSelect?.clearCustomBboxes) {
        window._previewSelect.clearCustomBboxes();
      }
      renderGroups(data);
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

  // ---------- step 2: render detected field groups ----------
  function renderGroups(data) {
    reviewSubhead.textContent = data.num_pages
      ? `${data.num_pages} page(s) scanned. Select fields directly in the preview — click the highlighted areas you want to mask.`
      : "Select fields directly in the preview — click the highlighted areas you want to mask.";
  }

  function truncate(s, n = 42) {
    if (!s) return "";
    return s.length > n ? s.slice(0, n) + "…" : s;
  }

  // ---------- preview rendering and interaction ----------
  function renderPreview(data) {
    if (!previewContainer) return;
    previewContainer.innerHTML = "";
    const previews = data.page_previews || [];
    const groups = data.groups || [];
    const groupToInstanceIds = {};
    const instanceToGroup = {};
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

      img.addEventListener("load", () => {
        const scale = img.clientWidth / img.naturalWidth || 1;
        for (const g of groups) {
          const bboxes = g.bboxes || [];
          const pages = g.pages || [];
          const instIds = g.instance_ids || [];
          // store mapping
          groupToInstanceIds[g.group_id] = instIds.slice();
          for (const iid of instIds) instanceToGroup[iid] = g.group_id;
          for (let i = 0; i < bboxes.length; i++) {
            if (pages[i] !== pageIndex) continue;
            const bbox = bboxes[i];
            const instanceId = instIds[i];
            const [x0, y0, x1, y1] = bbox;
            const box = document.createElement("button");
            box.type = "button";
            box.className = "preview-box";
            box.dataset.groupId = g.group_id;
            box.dataset.instanceId = instanceId;
            box.dataset.page = pageIndex;
            box.dataset.bbox = JSON.stringify([x0, y0, x1, y1]);
            box.style.left = `${x0 * scale}px`;
            box.style.top = `${y0 * scale}px`;
            box.style.width = `${(x1 - x0) * scale}px`;
            box.style.height = `${(y1 - y0) * scale}px`;
            box.addEventListener("click", (ev) => { ev.stopPropagation(); toggleInstance(instanceId); });
            pageEl.appendChild(box);
          }
        }
        updatePreviewSelection();
      });

      previewContainer.appendChild(pageEl);
    }
    // expose maps for later sync
    previewContainer._groupToInstanceIds = groupToInstanceIds;
    previewContainer._instanceToGroup = instanceToGroup;
  }

  // explicit per-instance selection set
  const selectedInstanceIds = new Set();

  function toggleInstance(instanceId) {
    if (!instanceId) return;
    if (selectedInstanceIds.has(instanceId)) selectedInstanceIds.delete(instanceId);
    else selectedInstanceIds.add(instanceId);
    updatePreviewSelection();
  }

  function getSelectedInstancePayload() {
    return Array.from(selectedInstanceIds);
  }

  function getSelectedBoxesPayload() {
    const boxes = [];
    previewContainer.querySelectorAll('.preview-box').forEach(box => {
      if (!box.dataset.instanceId || !selectedInstanceIds.has(box.dataset.instanceId)) return;
      const bbox = box.dataset.bbox ? JSON.parse(box.dataset.bbox) : null;
      if (!bbox) return;
      boxes.push({ page: parseInt(box.dataset.page || '0', 10), bbox });
    });
    return boxes;
  }

  function groupMatchesSelected(groupId) {
    const insts = (previewContainer._groupToInstanceIds && previewContainer._groupToInstanceIds[groupId]) || [];
    return insts.some(iid => selectedInstanceIds.has(iid));
  }

  function updatePreviewSelection() {
    if (!previewContainer) return;
    previewContainer.querySelectorAll('.preview-box').forEach(box => {
      const iid = box.dataset.instanceId;
      const selected = !!(iid && selectedInstanceIds.has(iid));
      box.classList.toggle('preview-box--selected', selected);
    });
  }

  // ---------- step 3: mask & download ----------
  backBtn.addEventListener("click", () => {
    stepReview.hidden = true;
    stepUpload.hidden = false;
    fileInput.value = "";
    fileNameEl.textContent = "";
    instructionsEl.value = "";
    setStatus(maskStatus, "", null);
    currentJobId = null;
    selectedInstanceIds.clear();
    if (window._previewSelect?.clearCustomBboxes) {
      window._previewSelect.clearCustomBboxes();
    }
    if (previewContainer) {
      previewContainer.innerHTML = "";
    }
  });

  undoBtn?.addEventListener("click", () => {
    if (window._previewSelect?.undo) {
      window._previewSelect.undo();
    }
  });

  redoBtn?.addEventListener("click", () => {
    if (window._previewSelect?.redo) {
      window._previewSelect.redo();
    }
  });

  maskBtn.addEventListener("click", async () => {
    if (!currentJobId) return;
    const selected = [];
    const instructions = instructionsEl.value.trim();
    const customBboxes = window._previewSelect?.getCustomBboxes?.() || [];

    const hasPreviewSelection = selectedInstanceIds.size > 0;
    if (selected.length === 0 && !instructions && customBboxes.length === 0 && !hasPreviewSelection) {
      setStatus(maskStatus, "Select at least one field, draw a box, or describe what to mask.", "error");
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
          group_ids: selected,
          instance_ids: getSelectedInstancePayload(),
          selected_boxes: getSelectedBoxesPayload(),
          instructions,
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
  });
})();
