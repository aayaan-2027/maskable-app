// static/preview-select.js
// Adds drag-to-select bounding boxes on rendered preview pages.
// Detects .preview-page nodes and attaches mouse/touch handlers.
// Emits customBboxes array for inclusion in /mask POST.

(function () {
  window.customBboxes = window.customBboxes || [];
  window.customBboxesUndo = window.customBboxesUndo || [];
  window.customBboxesRedo = window.customBboxesRedo || [];

  function emitBoxesChanged() {
    window.dispatchEvent(new CustomEvent('preview:boxes-changed'));
  }

  function attachToPreview(previewPageEl) {
    if (previewPageEl._previewSelectAttached) return;
    previewPageEl._previewSelectAttached = true;

    const img = previewPageEl.querySelector('img.preview-image');
    if (!img) return;

    let selEl = null;
    let state = null;

    function pageCoordsFromEvent(e) {
      const rect = img.getBoundingClientRect();
      let clientX, clientY;
      if (e.touches && e.touches.length) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else {
        clientX = e.clientX;
        clientY = e.clientY;
      }
      return { rect, x: clientX - rect.left, y: clientY - rect.top };
    }

    function startDrag(e) {
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      const { rect, x, y } = pageCoordsFromEvent(e);
      selEl = document.createElement('div');
      selEl.className = 'preview-selection';
      selEl.style.left = x + 'px';
      selEl.style.top = y + 'px';
      selEl.style.width = '0px';
      selEl.style.height = '0px';
      previewPageEl.appendChild(selEl);
      state = { startX: x, startY: y, rect };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      window.addEventListener('touchmove', onMove, { passive: false });
      window.addEventListener('touchend', onUp);
    }

    function onMove(e) {
      if (!state) return;
      e.preventDefault();
      const { x, y } = pageCoordsFromEvent(e);
      const { startX, startY } = state;
      const l = Math.min(startX, x), t = Math.min(startY, y);
      const w = Math.abs(x - startX), h = Math.abs(y - startY);
      selEl.style.left = l + 'px';
      selEl.style.top = t + 'px';
      selEl.style.width = w + 'px';
      selEl.style.height = h + 'px';
    }

    function onUp(e) {
      if (!state) return;
      e.preventDefault();
      const { x, y } = pageCoordsFromEvent(e);
      const { startX, startY } = state;
      const l = Math.min(startX, x), t = Math.min(startY, y);
      const r = Math.max(startX, x), b = Math.max(startY, y);

      if (selEl && selEl.parentNode) selEl.parentNode.removeChild(selEl);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
      state = null;

      const originalWidth = parseInt(img.dataset.originalWidth || img.naturalWidth, 10);
      const originalHeight = parseInt(img.dataset.originalHeight || img.naturalHeight, 10);
      const sx = originalWidth / rect.width;
      const sy = originalHeight / rect.height;
      const nl = Math.max(0, Math.round(l * sx));
      const nt = Math.max(0, Math.round(t * sy));
      const nr = Math.min(originalWidth, Math.round(r * sx));
      const nb = Math.min(originalHeight, Math.round(b * sy));
      if (nr - nl < 4 || nb - nt < 4) return;

      const pageAttr = previewPageEl.dataset.page;
      const pageIdx = pageAttr !== undefined ? parseInt(pageAttr, 10) : (parseInt(previewPageEl.dataset.pageIndex || '0', 10));

      const id = 'custom-' + (window.customBboxes.length + 1);
      const cb = { id, page: pageIdx, bbox: [nl, nt, nr, nb] };
      window.customBboxesUndo.push(cb);
      window.customBboxesRedo = [];
      window.customBboxes.push(cb);
      emitBoxesChanged();

      const box = document.createElement('button');
      box.className = 'preview-box preview-box--custom preview-box--selected';
      box.dataset.customId = id;
      const originalWidth = parseInt(img.dataset.originalWidth || img.naturalWidth, 10);
      const originalHeight = parseInt(img.dataset.originalHeight || img.naturalHeight, 10);
      const displayScaleX = img.clientWidth / originalWidth;
      const displayScaleY = img.clientHeight / originalHeight;
      box.style.left = (nl * displayScaleX) + 'px';
      box.style.top = (nt * displayScaleY) + 'px';
      box.style.width = ((nr - nl) * displayScaleX) + 'px';
      box.style.height = ((nb - nt) * displayScaleY) + 'px';
      previewPageEl.appendChild(box);

      box.addEventListener('contextmenu', function (ev) {
        ev.preventDefault();
        const cid = box.dataset.customId;
        const removed = window.customBboxes.filter(x => x.id === cid);
        window.customBboxes = window.customBboxes.filter(x => x.id !== cid);
        if (removed.length) {
          window.customBboxesUndo = window.customBboxesUndo.filter(x => x.id !== cid);
          window.customBboxesRedo = [];
        }
        box.remove();
        emitBoxesChanged();
      });
    }

    previewPageEl.addEventListener('mousedown', startDrag);
    previewPageEl.addEventListener('touchstart', startDrag, { passive: false });
  }

  const observer = new MutationObserver(function (mutations) {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.classList && node.classList.contains('preview-page')) {
          attachToPreview(node);
        } else {
          const pages = node.querySelectorAll ? node.querySelectorAll('.preview-page') : [];
          pages.forEach(attachToPreview);
        }
      }
    }
  });

  const root = document.querySelector('#preview-container') || document.body;
  observer.observe(root, { childList: true, subtree: true });
  document.querySelectorAll('.preview-page').forEach(attachToPreview);

  function refreshCustomBoxesFromState() {
    document.querySelectorAll('.preview-box.preview-box--custom').forEach(el => el.remove());
    document.querySelectorAll('.preview-page').forEach(pageEl => {
      const pageIndex = parseInt(pageEl.dataset.page || '0', 10);
      const boxes = window.customBboxes.filter(x => x.page === pageIndex);
      boxes.forEach(cb => {
        const img = pageEl.querySelector('img.preview-image');
        if (!img) return;
        const box = document.createElement('button');
        box.className = 'preview-box preview-box--custom preview-box--selected';
        box.dataset.customId = cb.id;
        const displayScaleX = img.clientWidth / img.naturalWidth;
        const displayScaleY = img.clientHeight / img.naturalHeight;
        const [nl, nt, nr, nb] = cb.bbox;
        box.style.left = (nl * displayScaleX) + 'px';
        box.style.top = (nt * displayScaleY) + 'px';
        box.style.width = ((nr - nl) * displayScaleX) + 'px';
        box.style.height = ((nb - nt) * displayScaleY) + 'px';
        pageEl.appendChild(box);
      });
    });
  }

  window._previewSelect = {
    getCustomBboxes: () => window.customBboxes,
    clearCustomBboxes: () => {
      window.customBboxes = [];
      window.customBboxesUndo = [];
      window.customBboxesRedo = [];
      document.querySelectorAll('.preview-box.preview-box--custom').forEach(el => el.remove());
      emitBoxesChanged();
    },
    undo: () => {
      const last = window.customBboxes.pop();
      if (!last) return false;
      window.customBboxesRedo.push(last);
      refreshCustomBoxesFromState();
      emitBoxesChanged();
      return true;
    },
    redo: () => {
      const next = window.customBboxesRedo.pop();
      if (!next) return false;
      window.customBboxes.push(next);
      refreshCustomBoxesFromState();
      emitBoxesChanged();
      return true;
    }
  };
})();
