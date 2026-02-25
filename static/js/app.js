(() => {
  const dropZone        = document.getElementById('dropZone');
  const dropZoneInner   = document.getElementById('dropZoneInner');
  const dropZoneCompact = document.getElementById('dropZoneCompact');
  const thumbnailStrip  = document.getElementById('thumbnailStrip');
  const fileInput       = document.getElementById('fileInput');
  const analyzeBtn      = document.getElementById('analyzeBtn');
  const clearBtn        = document.getElementById('clearBtn');
  const errorBanner     = document.getElementById('errorBanner');
  const errorText       = document.getElementById('errorText');
  const errorClose      = document.getElementById('errorClose');
  const resultsSection  = document.getElementById('resultsSection');
  const outfitSummary   = document.getElementById('outfitSummary');
  const cardsGrid       = document.getElementById('cardsGrid');

  const btnText   = analyzeBtn.querySelector('.btn-text');
  const btnLoader = analyzeBtn.querySelector('.btn-loader');

  // ── API key modal ─────────────────────────────────────────────────────────
  const settingsBtn  = document.getElementById('settingsBtn');
  const settingsBadge = document.getElementById('settingsBadge');
  const modalOverlay = document.getElementById('modalOverlay');
  const modalClose   = document.getElementById('modalClose');
  const apiKeyInput  = document.getElementById('apiKeyInput');
  const saveKeyBtn   = document.getElementById('saveKeyBtn');
  const clearKeyBtn  = document.getElementById('clearKeyBtn');

  const LS_KEY = 'fashionsense_api_key';

  function getSavedKey() { return localStorage.getItem(LS_KEY) || ''; }

  function updateBadge() {
    settingsBadge.classList.toggle('hidden', !getSavedKey());
  }

  function openModal() {
    apiKeyInput.value = getSavedKey();
    modalOverlay.classList.remove('hidden');
    apiKeyInput.focus();
  }

  function closeModal() { modalOverlay.classList.add('hidden'); }

  settingsBtn.addEventListener('click', openModal);
  modalClose.addEventListener('click', closeModal);
  modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  saveKeyBtn.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    if (key) {
      localStorage.setItem(LS_KEY, key);
    } else {
      localStorage.removeItem(LS_KEY);
    }
    updateBadge();
    closeModal();
  });

  clearKeyBtn.addEventListener('click', () => {
    localStorage.removeItem(LS_KEY);
    apiKeyInput.value = '';
    updateBadge();
  });

  // Initialise badge on load
  updateBadge();

  let selectedFile = null;

  // ── File selection ────────────────────────────────────────────────────────
  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) handleFiles(fileInput.files);
    // Reset input so re-selecting same file triggers change again
    fileInput.value = '';
  });

  // ── Drag & drop ───────────────────────────────────────────────────────────
  dropZone.addEventListener('dragover', e => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  });

  // ── Handle new files (appends to selectedFiles) ───────────────────────────
  function handleFiles(newFiles) {
    const valid = [];
    const bad   = [];
    Array.from(newFiles).forEach(f => {
      if (isAllowedFile(f)) valid.push(f);
      else bad.push(f.name);
    });

    if (bad.length) {
      showError(`Unsupported file type: ${bad.join(', ')}. Use JPG, PNG, WebP, GIF, or HEIC.`);
    }
    if (!valid.length) return;

    selectedFiles = [...selectedFiles, ...valid];
    hideError();
    resetResults();
    renderThumbnails();
    analyzeOutfit();
  }

  // ── Thumbnail rendering ───────────────────────────────────────────────────
  function renderThumbnails() {
    thumbnailStrip.innerHTML = '';

    if (!selectedFiles.length) {
      thumbnailStrip.classList.add('hidden');
      dropZoneInner.classList.remove('hidden');
      dropZoneCompact.classList.add('hidden');
      return;
    }

    // Switch drop zone to compact "add more" mode
    dropZoneInner.classList.add('hidden');
    dropZoneCompact.classList.remove('hidden');
    thumbnailStrip.classList.remove('hidden');

    selectedFiles.forEach((file, idx) => {
      const item = document.createElement('div');
      item.className = 'thumb-item';

      const removeBtn = document.createElement('button');
      removeBtn.className = 'thumb-remove';
      removeBtn.innerHTML = '✕';
      removeBtn.setAttribute('aria-label', `Remove ${esc(file.name)}`);
      removeBtn.addEventListener('click', e => {
        e.stopPropagation();
        removeFile(idx);
      });
      item.appendChild(removeBtn);

      if (isHeic(file)) {
        const ph = document.createElement('div');
        ph.className = 'thumb-placeholder';
        ph.innerHTML = `<span class="thumb-heic-icon">📷</span><span class="thumb-filename">${esc(file.name)}</span>`;
        item.appendChild(ph);
      } else {
        const img = document.createElement('img');
        img.className = 'thumb-img';
        img.alt = file.name;
        const reader = new FileReader();
        reader.onload = ev => { img.src = ev.target.result; };
        reader.readAsDataURL(file);
        item.appendChild(img);
      }

      thumbnailStrip.appendChild(item);
    });

    // Count badge
    const badge = document.createElement('div');
    badge.className = 'thumb-count';
    badge.textContent = `${selectedFiles.length} photo${selectedFiles.length > 1 ? 's' : ''} selected`;
    thumbnailStrip.prepend(badge);
  }

  function removeFile(idx) {
    selectedFiles.splice(idx, 1);
    if (!selectedFiles.length) {
      resetAll();
    } else {
      renderThumbnails();
    }
  }

  // ── Clear ─────────────────────────────────────────────────────────────────
  clearBtn.addEventListener('click', resetAll);

  function resetAll() {
    selectedFiles = [];
    fileInput.value = '';
    thumbnailStrip.innerHTML = '';
    thumbnailStrip.classList.add('hidden');
    dropZoneInner.classList.remove('hidden');
    dropZoneCompact.classList.add('hidden');
    analyzeBtn.disabled = true;
    clearBtn.disabled   = true;
    hideError();
    resetResults();
  }

  function resetResults() {
    resultsSection.classList.add('hidden');
    outfitSummary.innerHTML = '';
    cardsGrid.innerHTML = '';
  }

  // ── Analyze ───────────────────────────────────────────────────────────────
  analyzeBtn.addEventListener('click', analyzeOutfit);

  async function analyzeOutfit() {
    if (!selectedFiles.length) return;

    setLoading(true);
    hideError();
    resetResults();

    const formData = new FormData();
    formData.append('image', selectedFile);
    const apiKey = getSavedKey();
    if (apiKey) formData.append('api_key', apiKey);

    try {
      const resp = await fetch('/analyze', { method: 'POST', body: formData });
      const data = await resp.json();

      if (!resp.ok) {
        showError(data.error || 'Something went wrong. Please try again.');
        return;
      }
      renderResults(data);
    } catch {
      showError('Network error. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  // ── Render results ────────────────────────────────────────────────────────
  function renderResults(data) {
    const personRow = data.person_description
      ? `<div class="meta-item"><span class="label">Person Identified</span><span class="value">${esc(data.person_description)}</span></div>`
      : '';

    outfitSummary.innerHTML = `
      <span class="label">Outfit Analysis</span>
      <span class="value">${esc(data.outfit_description || '')}</span>
      <div class="meta-row">
        ${data.style        ? `<div class="meta-item"><span class="label">Style</span><span class="value">${esc(data.style)}</span></div>` : ''}
        ${data.color_palette ? `<div class="meta-item"><span class="label">Palette</span><span class="value">${esc(data.color_palette)}</span></div>` : ''}
        ${personRow}
      </div>
    `;

    const suggestions = data.suggestions || [];
    if (!suggestions.length) {
      cardsGrid.innerHTML = '<p style="color:var(--text-muted)">No suggestions returned.</p>';
    } else {
      cardsGrid.innerHTML = suggestions.map(renderCard).join('');
    }

    resultsSection.classList.remove('hidden');
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Human-readable labels for each shop key
  const LINK_LABELS = {
    amazon:          'Amazon',
    nordstrom:       'Nordstrom',
    j_crew:          'J.Crew',
    banana_republic: 'Banana Republic',
    madewell:        'Madewell',
    asos:            'ASOS',
    zara:            'Zara',
    hm:              'H&M',
    uniqlo:          'Uniqlo',
    revolve:         'Revolve',
  };

  function renderCard(s) {
    const lo  = s.estimated_price_low  ? `$${s.estimated_price_low}`  : '';
    const hi  = s.estimated_price_high ? `$${s.estimated_price_high}` : '';
    const priceRange = lo && hi ? `${lo} – ${hi}` : (lo || hi || 'Price varies');

    const linksHTML = Object.entries(s.links || {})
      .map(([key, url]) => {
        const label = LINK_LABELS[key] || key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        return `<a class="shop-link" href="${esc(url)}" target="_blank" rel="noopener">${esc(label)}</a>`;
      })
      .join('');

    return `
      <div class="card">
        ${s.category ? `<span class="card-category">${esc(s.category)}</span>` : ''}
        <h3 class="card-title">${esc(s.item || '')}</h3>
        <p class="card-desc">${esc(s.description || '')}</p>
        <div class="card-price">${priceRange} <span>est.</span></div>
        <div class="card-links">${linksHTML}</div>
      </div>
    `;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function setLoading(on) {
    analyzeBtn.disabled = on;
    clearBtn.disabled   = on;
    const count = selectedFiles.length;
    btnText.textContent = on
      ? (count > 1 ? `Analyzing ${count} photos…` : 'Analyzing…')
      : 'Analyze Outfit';
    btnLoader.classList.toggle('hidden', !on);
  }

  function showError(msg) {
    errorText.textContent = msg;
    errorBanner.classList.remove('hidden');
  }
  function hideError() { errorBanner.classList.add('hidden'); }

  errorClose.addEventListener('click', hideError);

  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
})();
