(() => {
  const dropZone      = document.getElementById('dropZone');
  const dropZoneInner = document.getElementById('dropZoneInner');
  const previewImg    = document.getElementById('previewImg');
  const fileInput     = document.getElementById('fileInput');
  const analyzeBtn    = document.getElementById('analyzeBtn');
  const clearBtn      = document.getElementById('clearBtn');
  const errorBanner   = document.getElementById('errorBanner');
  const errorText     = document.getElementById('errorText');
  const errorClose    = document.getElementById('errorClose');
  const resultsSection = document.getElementById('resultsSection');
  const outfitSummary  = document.getElementById('outfitSummary');
  const cardsGrid      = document.getElementById('cardsGrid');

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
    if (fileInput.files[0]) handleFile(fileInput.files[0]);
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
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  // ── Handle selected file ──────────────────────────────────────────────────
  function handleFile(file) {
    if (!file.type.startsWith('image/')) {
      showError('Please select an image file (JPG, PNG, WebP, or GIF).');
      return;
    }
    selectedFile = file;
    hideError();
    resetResults();

    const reader = new FileReader();
    reader.onload = e => {
      previewImg.src = e.target.result;
      previewImg.classList.remove('hidden');
      dropZoneInner.style.display = 'none';
    };
    reader.readAsDataURL(file);

    analyzeBtn.disabled = false;
    clearBtn.disabled = false;
  }

  // ── Clear ─────────────────────────────────────────────────────────────────
  clearBtn.addEventListener('click', resetAll);

  function resetAll() {
    selectedFile = null;
    fileInput.value = '';
    previewImg.src = '';
    previewImg.classList.add('hidden');
    dropZoneInner.style.display = '';
    analyzeBtn.disabled = true;
    clearBtn.disabled = true;
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
    if (!selectedFile) return;

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
    // Summary
    outfitSummary.innerHTML = `
      <span class="label">Outfit Analysis</span>
      <span class="value">${esc(data.outfit_description || '')}</span>
      <div class="meta-row">
        ${ data.style ? `<div class="meta-item"><span class="label">Style</span><span class="value">${esc(data.style)}</span></div>` : '' }
        ${ data.color_palette ? `<div class="meta-item"><span class="label">Palette</span><span class="value">${esc(data.color_palette)}</span></div>` : '' }
      </div>
    `;

    // Cards
    const suggestions = data.suggestions || [];
    if (suggestions.length === 0) {
      cardsGrid.innerHTML = '<p style="color:var(--text-muted)">No suggestions returned.</p>';
    } else {
      cardsGrid.innerHTML = suggestions.map(renderCard).join('');
    }

    resultsSection.classList.remove('hidden');
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderCard(s) {
    const lo  = s.estimated_price_low  ? `$${s.estimated_price_low}` : '';
    const hi  = s.estimated_price_high ? `$${s.estimated_price_high}` : '';
    const priceRange = lo && hi ? `${lo} – ${hi}` : (lo || hi || 'Price varies');

    const linksHTML = Object.entries(s.links || {})
      .map(([name, url]) =>
        `<a class="shop-link" href="${esc(url)}" target="_blank" rel="noopener">${esc(capitalise(name))}</a>`
      ).join('');

    return `
      <div class="card">
        ${ s.category ? `<span class="card-category">${esc(s.category)}</span>` : '' }
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
    clearBtn.disabled = on;
    btnText.textContent = on ? 'Analyzing…' : 'Analyze Outfit';
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

  function capitalise(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
})();
