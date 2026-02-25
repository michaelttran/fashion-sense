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

  // ── Roast ──────────────────────────────────────────────────────────────────
  const roastSection = document.getElementById('roastSection');
  const roastBtn     = document.getElementById('roastBtn');
  const roastCard    = document.getElementById('roastCard');
  const roastText    = document.getElementById('roastText');
  const roastBtnText   = roastBtn.querySelector('.btn-text');
  const roastBtnLoader = roastBtn.querySelector('.btn-loader-roast');

  let lastAnalysisData = null;

  roastBtn.addEventListener('click', async () => {
    if (!lastAnalysisData) return;

    roastBtn.disabled = true;
    roastBtnText.textContent = 'Bracing for impact…';
    roastBtnLoader.classList.remove('hidden');
    roastCard.classList.add('hidden');

    try {
      const payload = {
        outfit_description: lastAnalysisData.outfit_description || '',
        style:              lastAnalysisData.style              || '',
        color_palette:      lastAnalysisData.color_palette      || '',
        suggestions:        lastAnalysisData.suggestions        || [],
        api_key:            getSavedKey(),
      };

      const resp = await fetch('/roast', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });
      const data = await resp.json();

      roastText.textContent = resp.ok
        ? data.roast
        : (data.error || 'Could not generate roast. Try again.');
      roastCard.classList.remove('hidden');
    } catch {
      roastText.textContent = 'Network error. Try again.';
      roastCard.classList.remove('hidden');
    } finally {
      roastBtn.disabled = false;
      roastBtnText.textContent = 'Roast Me Again 🔥';
      roastBtnLoader.classList.add('hidden');
    }
  });

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

  let selectedFiles = [];

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
    lastAnalysisData = null;
    roastSection.classList.add('hidden');
    roastCard.classList.add('hidden');
  }

  // ── Analyze ───────────────────────────────────────────────────────────────
  analyzeBtn.addEventListener('click', analyzeOutfit);

  async function analyzeOutfit() {
    if (!selectedFiles.length) return;

    setLoading(true);
    hideError();
    resetResults();

    const formData = new FormData();
    const blobs = await Promise.all(selectedFiles.map(resizeImage));
    blobs.forEach((b, i) => {
      const name = selectedFiles[i].name.replace(/\.[^.]+$/, '') + '.jpg';
      formData.append('images', b, isHeic(selectedFiles[i]) ? selectedFiles[i].name : name);
    });
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
    } catch (err) {
      console.error('analyzeOutfit error:', err);
      showError('Network error. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  // ── Render results ────────────────────────────────────────────────────────
  function renderResults(data) {
    lastAnalysisData = data;
    roastSection.classList.remove('hidden');
    roastCard.classList.add('hidden');
    roastBtnText.textContent = 'Roast My Style 🔥';
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
      const CATEGORY_ORDER = ['tops', 'bottoms', 'shoes', 'outerwear', 'accessories', 'bags'];

      // Group suggestions by category, preserving defined order then any extras
      const groups = {};
      for (const s of suggestions) {
        const cat = (s.category || 'other').toLowerCase();
        (groups[cat] = groups[cat] || []).push(s);
      }
      const orderedCats = [
        ...CATEGORY_ORDER.filter(c => groups[c]),
        ...Object.keys(groups).filter(c => !CATEGORY_ORDER.includes(c)),
      ];

      cardsGrid.innerHTML = orderedCats.map(cat => `
        <div class="category-section">
          <h3 class="category-heading">${esc(cat.charAt(0).toUpperCase() + cat.slice(1))}</h3>
          <div class="cards-row">${groups[cat].map(renderCard).join('')}</div>
        </div>
      `).join('');
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
    soleretriever:   'Sole Retriever',
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

  function isHeic(file) {
    return /\.(heic|heif)$/i.test(file.name);
  }

  function isAllowedFile(file) {
    return /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(file.name);
  }

  async function resizeImage(file) {
    if (isHeic(file)) return file; // let backend handle HEIC
    return new Promise(resolve => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const max = Math.max(img.width, img.height);
        const scale = max > 1024 ? 1024 / max : 1;
        const canvas = document.createElement('canvas');
        canvas.width  = Math.round(img.width  * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(blob => resolve(blob ?? file), 'image/jpeg', 0.85);
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  }
})();
