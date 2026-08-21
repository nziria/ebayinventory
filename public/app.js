// eBay Inventory Manager - Mobile Frontend Logic with Onboarding & Timer Support

const state = {
  items: [],
  filteredItems: [],
  activeFilter: 'all',
  searchQuery: '',
  isRefreshing: false,
  isRestocking: false,
  isTestingConfig: false,
  rules: {},
  vault: {},
  monitorRunning: false,
  monitorInterval: 15,
  pendingQueue: {},
  isConfigured: false
};

// DOM Elements
const statusDot = document.getElementById('statusDot');
const statusLabel = document.getElementById('statusLabel');
const unconfiguredBanner = document.getElementById('unconfiguredBanner');
const btnOpenOnboardingFromBanner = document.getElementById('btnOpenOnboardingFromBanner');

const btnRunRestockNow = document.getElementById('btnRunRestockNow');
const btnForceRestockAll = document.getElementById('btnForceRestockAll');
const restockBtnText = document.getElementById('restockBtnText');
const toggleAutoMonitor = document.getElementById('toggleAutoMonitor');
const selectInterval = document.getElementById('selectInterval');
const monitorNextCheckText = document.getElementById('monitorNextCheckText');

const statTotalActive = document.getElementById('statTotalActive');
const statZeroCount = document.getElementById('statZeroCount');
const statPendingCount = document.getElementById('statPendingCount');
const statCardZero = document.getElementById('statCardZero');
const statCardPending = document.getElementById('statCardPending');

const filterCountAll = document.getElementById('filterCountAll');
const filterCountZero = document.getElementById('filterCountZero');
const filterCountPending = document.getElementById('filterCountPending');
const filterCountInStock = document.getElementById('filterCountInStock');

const searchInput = document.getElementById('searchInput');
const btnClearSearch = document.getElementById('btnClearSearch');
const btnRefreshListings = document.getElementById('btnRefreshListings');
const listingsContainer = document.getElementById('listingsContainer');
const filterTabs = document.querySelectorAll('.filter-tab');

// Config & Onboarding Modal
const configModal = document.getElementById('configModal');
const btnOpenConfigModal = document.getElementById('btnOpenConfigModal');
const btnCloseConfigModal = document.getElementById('btnCloseConfigModal');
const formConfig = document.getElementById('formConfig');
const cfgClientId = document.getElementById('cfgClientId');
const cfgClientSecret = document.getElementById('cfgClientSecret');
const cfgRefreshToken = document.getElementById('cfgRefreshToken');
const cfgEnv = document.getElementById('cfgEnv');
const cfgSiteId = document.getElementById('cfgSiteId');
const cfgInterval = document.getElementById('cfgInterval');
const cfgPort = document.getElementById('cfgPort');
const btnTestConfigConnection = document.getElementById('btnTestConfigConnection');
const btnSaveConfigSubmit = document.getElementById('btnSaveConfigSubmit');
const testResultBox = document.getElementById('testResultBox');

// Timer Modal
const timerModal = document.getElementById('timerModal');
const timerModalItemId = document.getElementById('timerModalItemId');
const timerModalItemTitle = document.getElementById('timerModalItemTitle');
const timerEnabledToggle = document.getElementById('timerEnabledToggle');
const timerDelayInput = document.getElementById('timerDelayInput');
const timerTargetQty = document.getElementById('timerTargetQty');
const btnCloseTimerModal = document.getElementById('btnCloseTimerModal');
const btnResetTimerRule = document.getElementById('btnResetTimerRule');
const formTimerRule = document.getElementById('formTimerRule');

// Price Modal
const priceModal = document.getElementById('priceModal');
const priceModalItemId = document.getElementById('priceModalItemId');
const priceModalCurrency = document.getElementById('priceModalCurrency');
const priceModalSku = document.getElementById('priceModalSku');
const priceModalItemTitle = document.getElementById('priceModalItemTitle');
const priceModalCurrentPriceDisplay = document.getElementById('priceModalCurrentPriceDisplay');
const priceModalNewPrice = document.getElementById('priceModalNewPrice');
const priceModalCurrencyLabel = document.getElementById('priceModalCurrencyLabel');
const priceModalVariationSpecs = document.getElementById('priceModalVariationSpecs');
const btnClosePriceModal = document.getElementById('btnClosePriceModal');
const btnCancelPriceModal = document.getElementById('btnCancelPriceModal');
const formUpdatePrice = document.getElementById('formUpdatePrice');
const btnSubmitPriceModal = document.getElementById('btnSubmitPriceModal');

// Key Vault Modal
const vaultModal = document.getElementById('vaultModal');
const btnOpenVaultModal = document.getElementById('btnOpenVaultModal');
const btnCloseVaultModal = document.getElementById('btnCloseVaultModal');
const vaultHeaderBadge = document.getElementById('vaultHeaderBadge');
const selectVaultTarget = document.getElementById('selectVaultTarget');
const vaultStockDisplay = document.getElementById('vaultStockDisplay');
const toggleVaultEnabled = document.getElementById('toggleVaultEnabled');
const toggleVaultAutoShip = document.getElementById('toggleVaultAutoShip');
const formAddKeys = document.getElementById('formAddKeys');
const textareaNewKeys = document.getElementById('textareaNewKeys');
const btnAddKeysSubmit = document.getElementById('btnAddKeysSubmit');
const availableKeysList = document.getElementById('availableKeysList');
const formSaveVaultSettings = document.getElementById('formSaveVaultSettings');
const textareaMessageTemplate = document.getElementById('textareaMessageTemplate');
const btnSaveVaultSettings = document.getElementById('btnSaveVaultSettings');
const vaultHistoryContainer = document.getElementById('vaultHistoryContainer');
const btnCheckOrdersNow = document.getElementById('btnCheckOrdersNow');

// Manual & Logs Modals
const manualModal = document.getElementById('manualModal');
const btnOpenManualModal = document.getElementById('btnOpenManualModal');
const btnCloseManualModal = document.getElementById('btnCloseManualModal');
const formManualUpdate = document.getElementById('formManualUpdate');

const logsDrawer = document.getElementById('logsDrawer');
const btnOpenLogs = document.getElementById('btnOpenLogs');
const btnCloseLogs = document.getElementById('btnCloseLogs');
const logsListContainer = document.getElementById('logsListContainer');
const toastContainer = document.getElementById('toastContainer');

// Utility: Toast notifications
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${message}</span>`;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Toggle password visibility
window.togglePasswordVisibility = function(inputId) {
  const input = document.getElementById(inputId);
  if (input) {
    input.type = input.type === 'password' ? 'text' : 'password';
  }
};

// Check Backend & eBay API Status
async function checkStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();

    state.isConfigured = Boolean(data.isConfigured);

    if (data.ebay && data.ebay.ok) {
      statusDot.className = 'status-dot online';
      statusLabel.textContent = `eBay Connesso (${data.environment})`;
      unconfiguredBanner.classList.add('hidden');
    } else if (data.isConfigured) {
      statusDot.className = 'status-dot offline';
      statusLabel.textContent = `Errore eBay: ${data.ebay.message || 'Verifica credenziali'}`;
      unconfiguredBanner.classList.add('hidden');
    } else {
      statusDot.className = 'status-dot offline';
      statusLabel.textContent = 'Credenziali non configurate';
      unconfiguredBanner.classList.remove('hidden');
    }

    if (data.monitor) {
      state.monitorRunning = data.monitor.isRunning;
      state.monitorInterval = data.monitor.intervalMinutes || 15;
      state.pendingQueue = data.monitor.pendingQueue || {};
      toggleAutoMonitor.checked = data.monitor.isRunning;
      if (document.activeElement !== selectInterval) {
        selectInterval.value = String(state.monitorInterval);
      }

      if (data.monitor.isRunning && data.monitor.nextCheckTime) {
        const nextDate = new Date(data.monitor.nextCheckTime);
        monitorNextCheckText.textContent = `Prossimo: ${nextDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      } else {
        monitorNextCheckText.textContent = 'Monitor non attivo';
      }
    }
  } catch (err) {
    statusDot.className = 'status-dot offline';
    statusLabel.textContent = 'Server non raggiungibile';
  }
}

// Load current configuration into modal
async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    const data = await res.json();

    cfgClientId.value = data.clientId || '';
    cfgClientSecret.value = data.clientSecret || '';
    cfgRefreshToken.value = data.refreshToken || '';
    cfgEnv.value = data.env || 'PRODUCTION';
    cfgSiteId.value = data.siteId || '101';
    cfgInterval.value = data.autoRestockInterval || 15;
    cfgPort.value = data.port || 3000;
  } catch (err) {
    console.error('Errore caricamento configurazione:', err);
  }
}

function openConfigModal() {
  loadConfig();
  testResultBox.className = 'test-result-box hidden';
  configModal.classList.remove('hidden');
}

btnOpenConfigModal.addEventListener('click', openConfigModal);
btnOpenOnboardingFromBanner.addEventListener('click', openConfigModal);

btnCloseConfigModal.addEventListener('click', () => {
  configModal.classList.add('hidden');
});

configModal.addEventListener('click', (e) => {
  if (e.target === configModal) configModal.classList.add('hidden');
});

// Toggle OAuth helper box
window.toggleOauthHelper = function() {
  const body = document.getElementById('oauthHelperBody');
  const arrow = document.getElementById('oauthHelperArrow');
  if (body) {
    const isHidden = body.classList.toggle('hidden');
    if (arrow) arrow.textContent = isHidden ? '▶' : '▼';
  }
};

// Genera e apri link di consenso eBay direttamente nel browser
const btnOpenEbayAuthUrl = document.getElementById('btnOpenEbayAuthUrl');
if (btnOpenEbayAuthUrl) {
  btnOpenEbayAuthUrl.addEventListener('click', () => {
    const clientId = cfgClientId.value.trim();
    const ruName = document.getElementById('cfgRuName').value.trim();
    const env = cfgEnv.value;

    if (!clientId || !ruName) {
      showToast('Inserisci prima il Client ID e il RuName', 'error');
      return;
    }

    const isSandbox = (env || 'PRODUCTION').toUpperCase() === 'SANDBOX';
    const baseUrl = isSandbox
      ? 'https://auth.sandbox.ebay.com/oauth2/authorize'
      : 'https://auth.ebay.com/oauth2/authorize';

    // Scopes ufficiali validi per eBay API
    const scopes = [
      'https://api.ebay.com/oauth/api_scope',
      'https://api.ebay.com/oauth/api_scope/sell.inventory',
      'https://api.ebay.com/oauth/api_scope/sell.account'
    ].join(' ');

    const authUrl = `${baseUrl}?client_id=${encodeURIComponent(clientId)}&response_type=code&redirect_uri=${encodeURIComponent(ruName)}&scope=${encodeURIComponent(scopes)}`;

    window.open(authUrl, '_blank');
    showToast('Aperta pagina eBay! Accedi, clicca "Accetto" e copia l\'URL di ritorno.', 'info');
  });
}

// Scambia il codice con il Refresh Token
const btnExchangeAuthCode = document.getElementById('btnExchangeAuthCode');
if (btnExchangeAuthCode) {
  btnExchangeAuthCode.addEventListener('click', async () => {
    const code = document.getElementById('cfgAuthCode').value.trim();
    const clientId = cfgClientId.value.trim();
    const clientSecret = cfgClientSecret.value.trim();
    const ruName = document.getElementById('cfgRuName').value.trim();
    const env = cfgEnv.value;

    if (!code || !clientId || !clientSecret || !ruName) {
      showToast('Compila tutti i campi (Client ID, Secret, RuName e Codice/Link)', 'error');
      return;
    }

    btnExchangeAuthCode.disabled = true;
    btnExchangeAuthCode.textContent = '⏳ Generazione in corso...';

    try {
      const res = await fetch('/api/oauth/exchange-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, clientId, clientSecret, ruName, env })
      });
      
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (err) {
        throw new Error('Il server deve essere riavviato per caricare la nuova funzione. Riavvia con avvia_windows.bat o node server.js');
      }

      if (!data.success) throw new Error(data.error || 'Errore');

      cfgRefreshToken.value = data.refreshToken;
      showToast('🎉 Refresh Token generato con successo!', 'success');
      
      // Esegui subito verifica connessione
      btnTestConfigConnection.click();
    } catch (e) {
      showToast(`Errore: ${e.message}`, 'error');
    } finally {
      btnExchangeAuthCode.disabled = false;
      btnExchangeAuthCode.textContent = '⚡ 2. Genera e Compila Refresh Token';
    }
  });
}

// Test Connection before saving
btnTestConfigConnection.addEventListener('click', async () => {
  const clientId = cfgClientId.value.trim();
  const clientSecret = cfgClientSecret.value.trim();
  const refreshToken = cfgRefreshToken.value.trim();
  const env = cfgEnv.value;
  const siteId = cfgSiteId.value;

  if (!clientId || !clientSecret || !refreshToken) {
    testResultBox.className = 'test-result-box error';
    testResultBox.innerHTML = '⚠️ Compila tutti i campi credenziali prima di verificare.';
    testResultBox.classList.remove('hidden');
    return;
  }

  btnTestConfigConnection.disabled = true;
  btnTestConfigConnection.textContent = '⏳ Verifica in corso...';
  testResultBox.className = 'test-result-box info';
  testResultBox.innerHTML = 'Connessione ai server eBay in corso...';
  testResultBox.classList.remove('hidden');

  try {
    const res = await fetch('/api/config/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, clientSecret, refreshToken, env, siteId })
    });
    const data = await res.json();

    if (data.success) {
      testResultBox.className = 'test-result-box success';
      testResultBox.innerHTML = `✅ <strong>Connessione Riuscita!</strong><br>Le credenziali sono valide. Orario eBay: ${data.ebayTime}`;
    } else {
      throw new Error(data.error || 'Credenziali non valide');
    }
  } catch (err) {
    testResultBox.className = 'test-result-box error';
    testResultBox.innerHTML = `❌ <strong>Verifica fallita:</strong><br>${err.message}`;
  } finally {
    btnTestConfigConnection.disabled = false;
    btnTestConfigConnection.textContent = '🔍 Verifica Connessione';
  }
});

// Save configuration to .env
formConfig.addEventListener('submit', async (e) => {
  e.preventDefault();

  const payload = {
    clientId: cfgClientId.value.trim(),
    clientSecret: cfgClientSecret.value.trim(),
    refreshToken: cfgRefreshToken.value.trim(),
    env: cfgEnv.value,
    siteId: cfgSiteId.value,
    autoRestockInterval: cfgInterval.value,
    port: cfgPort.value
  };

  btnSaveConfigSubmit.disabled = true;
  btnSaveConfigSubmit.textContent = '💾 Salvataggio in corso...';

  try {
    const res = await fetch('/api/config/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (!data.success) throw new Error(data.error || 'Errore durante il salvataggio');

    showToast('🎉 Credenziali salvate nel file .env con successo!', 'success');
    configModal.classList.add('hidden');
    
    // Riavvia stato e carica inserzioni
    await checkStatus();
    await loadListings();
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  } finally {
    btnSaveConfigSubmit.disabled = false;
    btnSaveConfigSubmit.textContent = '💾 Salva nel file .env e Avvia';
  }
});

// Load Active Listings
async function loadListings() {
  if (!state.isConfigured) {
    listingsContainer.innerHTML = `
      <div class="empty-state">
        <p>⚙️ Configura le tue credenziali eBay per visualizzare le inserzioni.</p>
        <button class="btn-primary btn-sm" onclick="openConfigModal()" style="margin: 14px auto 0; max-width: 200px;">Apri Configurazione</button>
      </div>
    `;
    return;
  }

  listingsContainer.innerHTML = `
    <div class="loading-state">
      <div class="spinner"></div>
      <p>Caricamento inserzioni eBay in corso...</p>
    </div>
  `;

  try {
    const res = await fetch('/api/listings?limit=100');
    const data = await res.json();

    if (!data.success) {
      throw new Error(data.error || 'Errore nel recupero inserzioni');
    }

    state.items = data.items || [];
    updateMetrics();
    applyFilterAndRender();
  } catch (err) {
    listingsContainer.innerHTML = `
      <div class="empty-state">
        <p style="color: var(--danger); font-weight: 600;">❌ Impossibile caricare le inserzioni</p>
        <p style="font-size: 0.8rem; margin-top: 6px;">${err.message}</p>
        <button class="btn-secondary btn-sm" onclick="loadListings()" style="margin: 14px auto 0;">Riprova</button>
      </div>
    `;
    showToast(err.message, 'error');
  }
}

// Update Top Metric Counters & Tab counts
function updateMetrics() {
  const total = state.items.length;
  const zeroCount = state.items.filter(i => i.quantityAvailable <= 0).length;
  const pendingCount = state.items.filter(i => i.pending).length;
  const inStockCount = total - zeroCount;

  statTotalActive.textContent = total;
  statZeroCount.textContent = zeroCount;
  statPendingCount.textContent = pendingCount;

  if (zeroCount > 0) {
    statCardZero.classList.add('stat-alert');
  } else {
    statCardZero.classList.remove('stat-alert');
  }

  if (pendingCount > 0) {
    statCardPending.classList.add('stat-pending');
  } else {
    statCardPending.classList.remove('stat-pending');
  }

  filterCountAll.textContent = total;
  filterCountZero.textContent = zeroCount;
  filterCountPending.textContent = pendingCount;
  filterCountInStock.textContent = inStockCount;
}

// Filter and Render Items
function applyFilterAndRender() {
  let filtered = [...state.items];

  // Filter by tab
  if (state.activeFilter === 'zero') {
    filtered = filtered.filter(i => i.quantityAvailable <= 0);
  } else if (state.activeFilter === 'pending') {
    filtered = filtered.filter(i => i.pending);
  } else if (state.activeFilter === 'instock') {
    filtered = filtered.filter(i => i.quantityAvailable > 0);
  }

  // Filter by search query
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    filtered = filtered.filter(i => 
      (i.title && i.title.toLowerCase().includes(q)) ||
      (i.sku && i.sku.toLowerCase().includes(q)) ||
      (i.itemId && i.itemId.includes(q))
    );
  }

  state.filteredItems = filtered;
  renderListings(filtered);
}

// Render Listings Cards
function renderListings(items) {
  if (items.length === 0) {
    listingsContainer.innerHTML = `
      <div class="empty-state">
        <p>Nessuna inserzione trovata con i filtri correnti.</p>
      </div>
    `;
    return;
  }

  listingsContainer.innerHTML = items.map(item => {
    const isZero = item.quantityAvailable <= 0;
    const isPending = Boolean(item.pending);
    const rule = item.rule || { delayMinutes: 0, enabled: true };
    const delay = rule.delayMinutes || 0;

    const thumbHtml = item.imageUrl
      ? `<img src="${item.imageUrl}" alt="${escapeHtml(item.title)}" class="listing-thumb" loading="lazy" onerror="this.outerHTML='<div class=\\'listing-thumb-fallback\\'>📦</div>'">`
      : `<div class="listing-thumb-fallback">📦</div>`;

    const stockBadge = isZero
      ? `<span class="current-stock-badge badge-zero">⚠️ Esaurito (0)</span>`
      : `<span class="current-stock-badge badge-instock">✅ Disp: ${item.quantityAvailable}</span>`;

    const timerBadge = delay > 0
      ? `<span class="timer-tag" onclick="openTimerModal('${item.itemId}')" title="Timer ritardo">⏱️ ${delay}m</span>`
      : `<span class="timer-tag" onclick="openTimerModal('${item.itemId}')" style="opacity:0.6;" title="Ripristino istantaneo">⏱️ 0m</span>`;

    let pendingBannerHtml = '';
    if (isPending && item.pending) {
      const targetTime = new Date(item.pending.scheduledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      pendingBannerHtml = `
        <div class="pending-timer-banner">
          <span>⏳ Ripristino tra ~${item.pending.minutesLeft} min (alle ${targetTime})</span>
          <button class="btn-force-single" onclick="forceRestockSingle('${item.itemId}')">⚡ Ripristina Ora</button>
        </div>
      `;
    }

    let variationsHtml = '';
    if (item.hasVariations && item.variations && item.variations.length > 0) {
      variationsHtml = `
        <div class="variations-container">
          <div class="variations-header">
            <span>🏷️ Varianti Prodotto (${item.variations.length})</span>
            <span style="font-weight: 400; font-size: 0.72rem; color: var(--text-muted);">Tocca 💰 per modificare il prezzo</span>
          </div>
      `;
      item.variations.forEach((v, vIdx) => {
        const vStockBadge = v.isZero
          ? `<span class="current-stock-badge badge-zero" style="font-size:0.75rem; padding:2px 8px;">⚠️ 0</span>`
          : `<span class="current-stock-badge badge-instock" style="font-size:0.75rem; padding:2px 8px;">✅ ${v.quantityAvailable}</span>`;

        const varTargetKey = `${item.itemId}::${v.name.trim().toLowerCase()}`;
        const varVault = state.vault[varTargetKey];
        const varVaultBadge = varVault && varVault.enabled
          ? `<span class="vault-badge-card ${varVault.availableCount === 0 ? 'zero' : ''}" onclick="openVaultModal('${varTargetKey}')" title="Chiavi disponibili nel Vault">🔑 ${varVault.availableCount} chiavi</span>`
          : '';

        variationsHtml += `
          <div class="variation-row ${v.isZero ? 'zero-stock' : ''}">
            <div class="variation-info">
              <span class="variation-name">${escapeHtml(v.name)}</span>
              <div class="variation-meta">
                <span class="price-tag" onclick="openPriceModal('${item.itemId}', ${vIdx})" title="Modifica prezzo di questa variante">💰 ${v.price} ${v.currency} <span class="price-edit-icon">✏️</span></span>
                ${v.sku ? `<span class="sku-tag">SKU: ${escapeHtml(v.sku)}</span>` : ''}
                ${vStockBadge}
                ${varVaultBadge}
              </div>
            </div>
            <div class="stepper-group">
              <button class="stepper-btn" onclick="stepItemQty('${item.itemId}', -5, ${vIdx})">-5</button>
              <button class="stepper-btn" onclick="stepItemQty('${item.itemId}', -1, ${vIdx})">-1</button>
              <input type="number" 
                     id="input-qty-${item.itemId}-${vIdx}" 
                     class="stepper-input" 
                     value="${v.quantityAvailable <= 0 ? 1 : v.quantityAvailable}" 
                     min="0">
              <button class="stepper-btn" onclick="stepItemQty('${item.itemId}', 1, ${vIdx})">+1</button>
              <button class="stepper-btn" onclick="stepItemQty('${item.itemId}', 5, ${vIdx})">+5</button>
              <button class="btn-save-qty" id="btn-save-${item.itemId}-${vIdx}" onclick="submitItemQty('${item.itemId}', ${vIdx})">Salva</button>
            </div>
          </div>
        `;
      });
      variationsHtml += `</div>`;
    }

    const itemVault = state.vault[String(item.itemId)];
    const itemVaultBadge = itemVault && itemVault.enabled && !item.hasVariations
      ? `<span class="vault-badge-card ${itemVault.availableCount === 0 ? 'zero' : ''}" onclick="openVaultModal('${item.itemId}')" title="Chiavi disponibili nel Vault">🔑 ${itemVault.availableCount} chiavi</span>`
      : '';

    const singleItemControlRow = (!item.hasVariations) ? `
      <div class="stock-control-row">
        <div class="stock-badge-group">
          ${stockBadge}
          ${itemVaultBadge}
          <button class="btn-timer-settings" onclick="openTimerModal('${item.itemId}')" title="Configura Timer Auto-Restock">⏱️</button>
        </div>
        <div class="stepper-group">
          <button class="stepper-btn" onclick="stepItemQty('${item.itemId}', -5)">-5</button>
          <button class="stepper-btn" onclick="stepItemQty('${item.itemId}', -1)">-1</button>
          <input type="number" 
                 id="input-qty-${item.itemId}" 
                 class="stepper-input" 
                 value="${item.quantityAvailable <= 0 ? 1 : item.quantityAvailable}" 
                 min="0">
          <button class="stepper-btn" onclick="stepItemQty('${item.itemId}', 1)">+1</button>
          <button class="stepper-btn" onclick="stepItemQty('${item.itemId}', 5)">+5</button>
          <button class="btn-save-qty" id="btn-save-${item.itemId}" onclick="submitItemQty('${item.itemId}')">Salva</button>
        </div>
      </div>
    ` : `
      <div class="stock-control-row" style="padding-top: 6px;">
        <div class="stock-badge-group">
          ${stockBadge}
          <span class="badge-var-count">🏷️ ${item.variations.length} Varianti</span>
          <button class="btn-timer-settings" onclick="openTimerModal('${item.itemId}')" title="Configura Timer Auto-Restock">⏱️</button>
        </div>
      </div>
    `;

    return `
      <div class="listing-card ${isZero ? (isPending ? 'pending-restock' : 'zero-stock') : ''}" id="card-${item.itemId}">
        ${pendingBannerHtml}
        <div class="listing-main">
          ${thumbHtml}
          <div class="listing-info">
            <a href="${item.viewUrl}" target="_blank" rel="noopener" class="listing-title" title="${escapeHtml(item.title)}">
              ${escapeHtml(item.title)}
            </a>
            <div class="listing-meta">
              ${!item.hasVariations ? `<span class="price-tag" onclick="openPriceModal('${item.itemId}')" title="Clicca per modificare il prezzo su eBay">💰 ${item.price} ${item.currency} <span class="price-edit-icon">✏️</span></span>` : ''}
              ${item.sku ? `<span class="sku-tag">SKU: ${escapeHtml(item.sku)}</span>` : ''}
              ${item.quantitySold > 0 ? `<span class="sku-tag" title="Storico vendite totali di questa inserzione">🛒 ${item.quantitySold} venduti</span>` : ''}
              ${timerBadge}
              <span title="Item ID">#${item.itemId}</span>
            </div>
          </div>
        </div>

        ${singleItemControlRow}
        ${variationsHtml}
      </div>
    `;
  }).join('');
}

// Stepper adjustment for a card or variation
window.stepItemQty = function(itemId, delta, varIndex = null) {
  const inputId = varIndex !== null ? `input-qty-${itemId}-${varIndex}` : `input-qty-${itemId}`;
  const input = document.getElementById(inputId);
  if (!input) return;
  let val = parseInt(input.value || '0', 10) + delta;
  if (val < 0) val = 0;
  input.value = val;
};

// Adjust helper for modal
window.adjustInput = function(inputId, delta) {
  const input = document.getElementById(inputId);
  if (!input) return;
  let val = parseInt(input.value || '0', 10) + delta;
  if (val < 0) val = 0;
  input.value = val;
};

// Open Timer Configuration Modal for an Item
window.openTimerModal = function(itemId) {
  const item = state.items.find(i => i.itemId === itemId);
  if (!item) return;

  timerModalItemId.value = item.itemId;
  timerModalItemTitle.textContent = `${item.title} (#${item.itemId})`;

  const rule = item.rule || { enabled: true, delayMinutes: 0, targetQty: 1 };
  timerEnabledToggle.checked = rule.enabled !== false;
  timerDelayInput.value = rule.delayMinutes || 0;
  timerTargetQty.value = rule.targetQty || 1;

  highlightTimerPill(rule.delayMinutes || 0);
  timerModal.classList.remove('hidden');
};

window.selectQuickTimer = function(minutes) {
  timerDelayInput.value = minutes;
  highlightTimerPill(minutes);
};

function highlightTimerPill(minutes) {
  const pills = document.querySelectorAll('.quick-timer-pills .pill-btn');
  pills.forEach(p => {
    const pillMins = parseInt(p.textContent, 10) || 0;
    if (pillMins === minutes || (minutes === 0 && p.textContent.includes('0m'))) {
      p.classList.add('active');
    } else {
      p.classList.remove('active');
    }
  });
}

timerDelayInput.addEventListener('input', (e) => {
  highlightTimerPill(parseInt(e.target.value, 10));
});

btnCloseTimerModal.addEventListener('click', () => {
  timerModal.classList.add('hidden');
});

timerModal.addEventListener('click', (e) => {
  if (e.target === timerModal) timerModal.classList.add('hidden');
});

// Save Timer Rule for Item
formTimerRule.addEventListener('submit', async (e) => {
  e.preventDefault();
  const itemId = timerModalItemId.value;
  const item = state.items.find(i => i.itemId === itemId);
  const enabled = timerEnabledToggle.checked;
  const delayMinutes = parseInt(timerDelayInput.value, 10) || 0;
  const targetQty = parseInt(timerTargetQty.value, 10) || 1;

  try {
    const res = await fetch('/api/rules/set', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        itemId,
        enabled,
        delayMinutes,
        targetQty,
        title: item ? item.title : '',
        sku: item ? item.sku : ''
      })
    });

    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Errore salvataggio regola');

    showToast(`⏱️ Regola salvata: ritardo ${delayMinutes} min per ${item ? item.title : itemId}`, 'success');
    timerModal.classList.add('hidden');

    if (item) {
      item.rule = data.rule;
    }
    applyFilterAndRender();
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  }
});

// Open Price Modal
window.openPriceModal = function(itemId, varIndex = null) {
  const item = state.items.find(i => i.itemId === itemId);
  if (!item) return;

  priceModalItemId.value = item.itemId;
  const isVar = varIndex !== null && item.hasVariations && item.variations && item.variations[varIndex];

  if (isVar) {
    const variation = item.variations[varIndex];
    priceModalItemTitle.textContent = `${item.title} [${variation.name}]`;
    priceModalCurrentPriceDisplay.textContent = `${variation.price} ${variation.currency || 'EUR'}`;
    priceModalCurrencyLabel.textContent = variation.currency || 'EUR';
    priceModalCurrency.value = variation.currency || 'EUR';
    priceModalSku.value = variation.sku || '';
    priceModalVariationSpecs.value = JSON.stringify(variation.variationSpecifics || null);
    priceModalNewPrice.value = variation.price || '';
    priceModal.dataset.varIndex = varIndex;
  } else {
    priceModalItemTitle.textContent = `${item.title} (#${item.itemId})`;
    priceModalCurrentPriceDisplay.textContent = `${item.price} ${item.currency || 'EUR'}`;
    priceModalCurrencyLabel.textContent = item.currency || 'EUR';
    priceModalCurrency.value = item.currency || 'EUR';
    priceModalSku.value = item.sku || '';
    priceModalVariationSpecs.value = '';
    priceModalNewPrice.value = item.price || '';
    delete priceModal.dataset.varIndex;
  }

  priceModal.classList.remove('hidden');
  setTimeout(() => priceModalNewPrice.focus(), 100);
};

if (btnClosePriceModal) {
  btnClosePriceModal.addEventListener('click', () => priceModal.classList.add('hidden'));
}
if (btnCancelPriceModal) {
  btnCancelPriceModal.addEventListener('click', () => priceModal.classList.add('hidden'));
}

if (formUpdatePrice) {
  formUpdatePrice.addEventListener('submit', async (e) => {
    e.preventDefault();
    const itemId = priceModalItemId.value;
    const newPrice = parseFloat(priceModalNewPrice.value);
    const currency = priceModalCurrency.value || 'EUR';
    const sku = priceModalSku.value || null;
    const item = state.items.find(i => i.itemId === itemId);
    const varIndex = priceModal.dataset.varIndex !== undefined ? parseInt(priceModal.dataset.varIndex, 10) : null;
    
    let variationSpecifics = null;
    const specsVal = priceModalVariationSpecs.value;
    if (specsVal) {
      try { variationSpecifics = JSON.parse(specsVal); } catch(err) {}
    }

    if (isNaN(newPrice) || newPrice <= 0) {
      showToast('Inserisci un prezzo valido maggiore di 0', 'error');
      return;
    }

    btnSubmitPriceModal.disabled = true;
    btnSubmitPriceModal.textContent = '⏳ Salvataggio su eBay...';

    try {
      const res = await fetch('/api/update-price', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId,
          price: newPrice,
          currency,
          sku,
          variationSpecifics,
          title: item ? item.title : itemId
        })
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Errore modifica prezzo');

      showToast(`✅ Prezzo aggiornato a ${data.data.newPrice} ${data.data.currency} su eBay!`, 'success');
      priceModal.classList.add('hidden');

      if (varIndex !== null && item && item.variations && item.variations[varIndex]) {
        item.variations[varIndex].price = data.data.newPrice;
      } else if (item) {
        item.price = data.data.newPrice;
      }
      applyFilterAndRender();
    } catch (err) {
      showToast(`❌ ${err.message}`, 'error');
    } finally {
      btnSubmitPriceModal.disabled = false;
      btnSubmitPriceModal.textContent = '💾 Salva Prezzo su eBay';
    }
  });
}

// Reset Rule to Default
btnResetTimerRule.addEventListener('click', async () => {
  const itemId = timerModalItemId.value;
  try {
    const res = await fetch('/api/rules/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Regola reimpostata ai valori predefiniti', 'info');
      timerModal.classList.add('hidden');
      loadListings();
    }
  } catch (err) {
    showToast('Errore reset regola', 'error');
  }
});

// Force Restock Single Item
window.forceRestockSingle = async function(itemId) {
  try {
    showToast('⏳ Ripristino forzato in corso...', 'info');
    const res = await fetch('/api/auto-restock/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ forceAll: true, itemId })
    });
    const data = await res.json();
    if (data.success) {
      showToast('✅ Inserzione ripristinata con successo!', 'success');
      loadListings();
    } else {
      throw new Error(data.error || 'Errore');
    }
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  }
};

// Force Restock All (Skip Timers)
btnForceRestockAll.addEventListener('click', async () => {
  if (confirm('Sei sicuro di voler forzare il ripristino immediato a 1 di TUTTE le inserzioni a zero, saltando i timer?')) {
    try {
      showToast('⚡ Ripristino forzato di tutte le inserzioni in corso...', 'info');
      const res = await fetch('/api/auto-restock/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forceAll: true })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`🎉 Ripristinate ${data.data.restockedCount} inserzioni!`, 'success');
        loadListings();
      }
    } catch (err) {
      showToast(`❌ ${err.message}`, 'error');
    }
  }
});

// Submit Manual Quantity Update (Funzione 2)
window.submitItemQty = async function(itemId, varIndex = null) {
  const item = state.items.find(i => i.itemId === itemId);
  const inputId = varIndex !== null ? `input-qty-${itemId}-${varIndex}` : `input-qty-${itemId}`;
  const btnId = varIndex !== null ? `btn-save-${itemId}-${varIndex}` : `btn-save-${itemId}`;
  const input = document.getElementById(inputId);
  const saveBtn = document.getElementById(btnId);
  if (!input) return;

  const newQty = parseInt(input.value, 10);
  if (isNaN(newQty) || newQty < 0) {
    showToast('Inserisci una quantità valida (>= 0)', 'error');
    return;
  }

  const isVar = varIndex !== null && item && item.hasVariations && item.variations && item.variations[varIndex];
  const variation = isVar ? item.variations[varIndex] : null;

  const originalBtnText = saveBtn ? saveBtn.textContent : 'Salva';
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = '...';
  }

  try {
    const res = await fetch('/api/update-quantity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        itemId,
        quantity: newQty,
        sku: variation ? variation.sku : (item ? item.sku : null),
        quantitySold: variation ? variation.quantitySold : (item ? item.quantitySold : 0),
        variationSpecifics: variation ? variation.variationSpecifics : null,
        title: variation ? `${item.title} [${variation.name}]` : (item ? item.title : itemId)
      })
    });

    const data = await res.json();
    if (!data.success) {
      throw new Error(data.error || 'Aggiornamento fallito');
    }

    showToast(`✅ Quantità aggiornata a ${newQty}!`, 'success');
    
    if (variation) {
      variation.quantityAvailable = newQty;
      variation.isZero = newQty <= 0;
      item.quantityAvailable = item.variations.reduce((s, v) => s + v.quantityAvailable, 0);
      item.isZero = item.variations.some(v => v.isZero);
    } else if (item) {
      item.quantityAvailable = newQty;
      item.isZero = newQty <= 0;
      if (newQty > 0) item.pending = null;
    }
    updateMetrics();
    applyFilterAndRender();
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = originalBtnText;
    }
  }
};

// Run Instant Auto-Restock with Timers (Funzione 1)
btnRunRestockNow.addEventListener('click', async () => {
  if (state.isRestocking) return;
  state.isRestocking = true;
  btnRunRestockNow.disabled = true;
  restockBtnText.textContent = 'Scansione in corso...';

  try {
    const res = await fetch('/api/auto-restock/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ forceAll: false })
    });
    const data = await res.json();

    if (!data.success) {
      throw new Error(data.error || 'Errore durante auto-restock');
    }

    const summary = data.data;
    if (summary.restockedCount > 0) {
      showToast(`🎉 Ripristinate ${summary.restockedCount} inserzioni!`, 'success');
    } else if (summary.pendingQueueCount > 0) {
      showToast(`⏳ ${summary.pendingQueueCount} inserzioni in attesa di timer programmato.`, 'info');
    } else {
      showToast(`Tutto in ordine: nessuna inserzione esaurita.`, 'info');
    }

    await loadListings();
    await checkStatus();
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  } finally {
    state.isRestocking = false;
    btnRunRestockNow.disabled = false;
    restockBtnText.textContent = 'Esegui Auto-Restock (con Timer)';
  }
});

// Toggle Background Monitor
toggleAutoMonitor.addEventListener('change', async (e) => {
  const enabled = e.target.checked;
  const intervalMinutes = parseInt(selectInterval.value, 10);

  try {
    const res = await fetch('/api/auto-restock/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled, intervalMinutes })
    });
    const data = await res.json();
    if (data.success) {
      showToast(enabled ? `Monitor automatico avviato (ogni ${intervalMinutes}m)` : 'Monitor automatico fermato', 'info');
      await checkStatus();
    }
  } catch (err) {
    showToast('Errore nel cambio stato monitor', 'error');
    toggleAutoMonitor.checked = !enabled;
  }
});

// Change Monitor Scan Interval & Save to .env
selectInterval.addEventListener('change', async (e) => {
  const intervalMinutes = parseInt(e.target.value, 10);
  try {
    const res = await fetch('/api/auto-restock/interval', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intervalMinutes })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`⏱️ Intervallo monitor impostato a ogni ${intervalMinutes} min e salvato!`, 'success');
      state.monitorInterval = intervalMinutes;
      await checkStatus();
    } else {
      throw new Error(data.error);
    }
  } catch (err) {
    showToast(`Errore salvataggio intervallo: ${err.message}`, 'error');
  }
});

// Filter Tabs Click
filterTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    filterTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    state.activeFilter = tab.dataset.filter;
    applyFilterAndRender();
  });
});

// Search Input
searchInput.addEventListener('input', (e) => {
  state.searchQuery = e.target.value;
  btnClearSearch.classList.toggle('hidden', !state.searchQuery);
  applyFilterAndRender();
});

btnClearSearch.addEventListener('click', () => {
  searchInput.value = '';
  state.searchQuery = '';
  btnClearSearch.classList.add('hidden');
  applyFilterAndRender();
});

btnRefreshListings.addEventListener('click', () => {
  loadListings();
  checkStatus();
});

// Manual Modal Handlers
btnOpenManualModal.addEventListener('click', () => {
  manualModal.classList.remove('hidden');
});

btnCloseManualModal.addEventListener('click', () => {
  manualModal.classList.add('hidden');
});

manualModal.addEventListener('click', (e) => {
  if (e.target === manualModal) manualModal.classList.add('hidden');
});

formManualUpdate.addEventListener('submit', async (e) => {
  e.preventDefault();
  const target = document.getElementById('manualTarget').value.trim();
  const qty = parseInt(document.getElementById('manualQuantity').value, 10);

  if (!target) return;

  const isNumeric = /^\d{10,14}$/.test(target);
  const itemId = isNumeric ? target : null;
  const sku = !isNumeric ? target : null;

  try {
    const res = await fetch('/api/update-quantity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId, sku, quantity: qty })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Errore');

    showToast(`✅ Inserzione ${target} aggiornata a ${qty}!`, 'success');
    manualModal.classList.add('hidden');
    formManualUpdate.reset();
    loadListings();
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  }
});

// Logs Drawer Handlers
btnOpenLogs.addEventListener('click', async () => {
  logsDrawer.classList.remove('hidden');
  try {
    const res = await fetch('/api/logs');
    const data = await res.json();
    if (data.logs && data.logs.length > 0) {
      logsListContainer.innerHTML = data.logs.map(log => `
        <div class="log-item ${log.type}">
          <span class="log-time">${new Date(log.timestamp).toLocaleTimeString()} - ${new Date(log.timestamp).toLocaleDateString()}</span>
          <span>${escapeHtml(log.message)}</span>
        </div>
      `).join('');
    } else {
      logsListContainer.innerHTML = '<p class="empty-state">Nessuna attività registrata.</p>';
    }
  } catch (e) {
    logsListContainer.innerHTML = '<p class="empty-state">Errore caricamento log.</p>';
  }
});

btnCloseLogs.addEventListener('click', () => {
  logsDrawer.classList.add('hidden');
});

logsDrawer.addEventListener('click', (e) => {
  if (e.target === logsDrawer) logsDrawer.classList.add('hidden');
});

// Utility: Escape HTML
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ==========================================
// KEY VAULT & DIGITAL DELIVERY HANDLERS
// ==========================================

const DEFAULT_VAULT_TEMPLATE = `Dear Customer, 

Thank you very much for your purchase of {PRODUCT_NAME}!  

Please find your activation key below: 

Product Key:  
{KEY} 

Activation Instructions: 

Go to Settings > System > Activation. 

Select Change product key. 

Enter the key provided above and follow the on-screen instructions. 

If you encounter any issues or have any questions regarding the activation, please do not hesitate to contact me directly through eBay messages. I am here to assist you and ensure everything works perfectly. 

If you are satisfied with your purchase, I would kindly appreciate it if you could leave me positive feedback. It is very important to me and greatly appreciated. 

Thank you again for your trust and have a wonderful day! 

Best regards,`;

async function loadVaultSummary() {
  try {
    const res = await fetch('/api/vault/summary');
    const data = await res.json();
    if (data.success) {
      state.vault = data.vault || {};
      updateVaultHeaderBadge();
    }
  } catch (e) {
    console.error('Errore caricamento Vault:', e.message);
  }
}

function updateVaultHeaderBadge() {
  if (!vaultHeaderBadge) return;
  let totalAvailable = 0;
  for (const item of Object.values(state.vault)) {
    if (item.enabled) {
      totalAvailable += item.availableCount || 0;
    }
  }
  vaultHeaderBadge.textContent = totalAvailable;
}

window.switchVaultTab = function(tabName) {
  const tabs = ['keys', 'template', 'history'];
  tabs.forEach(t => {
    const btn = document.getElementById(`btnTabVault${t.charAt(0).toUpperCase() + t.slice(1)}`);
    const content = document.getElementById(`vaultTab${t.charAt(0).toUpperCase() + t.slice(1)}`);
    if (btn) btn.classList.toggle('active', t === tabName);
    if (content) content.classList.toggle('hidden', t !== tabName);
  });
  if (tabName === 'history') {
    loadVaultHistory();
  }
};

window.insertVaultTag = function(tag) {
  if (!textareaMessageTemplate) return;
  const start = textareaMessageTemplate.selectionStart;
  const end = textareaMessageTemplate.selectionEnd;
  const text = textareaMessageTemplate.value;
  textareaMessageTemplate.value = text.substring(0, start) + tag + text.substring(end);
  textareaMessageTemplate.focus();
  textareaMessageTemplate.selectionStart = textareaMessageTemplate.selectionEnd = start + tag.length;
};

window.resetDefaultVaultTemplate = function() {
  if (confirm('Vuoi ripristinare il template predefinito?')) {
    textareaMessageTemplate.value = DEFAULT_VAULT_TEMPLATE;
  }
};

window.openVaultModal = function(preferredTargetKey = null) {
  if (!selectVaultTarget) return;

  // Popola select
  selectVaultTarget.innerHTML = '';
  state.items.forEach(item => {
    if (item.hasVariations && item.variations && item.variations.length > 0) {
      const optGroup = document.createElement('optgroup');
      optGroup.label = item.title;
      item.variations.forEach(v => {
        const vKey = `${item.itemId}::${v.name.trim().toLowerCase()}`;
        const vVault = state.vault[vKey];
        const count = vVault ? vVault.availableCount : 0;
        const opt = document.createElement('option');
        opt.value = vKey;
        opt.textContent = `${v.name} (${count} chiavi nel Vault)`;
        opt.dataset.title = `${item.title} [${v.name}]`;
        opt.dataset.sku = v.sku || '';
        optGroup.appendChild(opt);
      });
      selectVaultTarget.appendChild(optGroup);
    } else {
      const iKey = String(item.itemId);
      const iVault = state.vault[iKey];
      const count = iVault ? iVault.availableCount : 0;
      const opt = document.createElement('option');
      opt.value = iKey;
      opt.textContent = `${item.title} (#${item.itemId}) (${count} chiavi nel Vault)`;
      opt.dataset.title = item.title;
      opt.dataset.sku = item.sku || '';
      selectVaultTarget.appendChild(opt);
    }
  });

  if (preferredTargetKey && selectVaultTarget.querySelector(`option[value="${preferredTargetKey}"]`)) {
    selectVaultTarget.value = preferredTargetKey;
  }

  onVaultTargetChange();
  vaultModal.classList.remove('hidden');
};

function onVaultTargetChange() {
  const selectedKey = selectVaultTarget.value;
  if (!selectedKey) return;

  const itemVault = state.vault[selectedKey] || {
    enabled: false,
    autoShip: true,
    template: DEFAULT_VAULT_TEMPLATE,
    availableCount: 0,
    availableKeys: []
  };

  vaultStockDisplay.textContent = itemVault.availableCount || 0;
  vaultStockDisplay.className = `vault-stock-number ${itemVault.availableCount > 0 ? 'in-stock' : 'zero'}`;

  toggleVaultEnabled.checked = itemVault.enabled === true;
  toggleVaultAutoShip.checked = itemVault.autoShip !== false;
  textareaMessageTemplate.value = itemVault.template || DEFAULT_VAULT_TEMPLATE;

  // Render available keys list
  if (itemVault.availableKeys && itemVault.availableKeys.length > 0) {
    availableKeysList.innerHTML = itemVault.availableKeys.map(k => `
      <span class="key-pill">
        <span>${escapeHtml(k.code)}</span>
        <button type="button" class="btn-delete-key" onclick="deleteVaultKey('${selectedKey}', '${k.id}')" title="Elimina chiave">&times;</button>
      </span>
    `).join('');
  } else {
    availableKeysList.innerHTML = '<span style="color: var(--text-muted); font-size: 0.8rem;">Nessuna chiave caricata per questo articolo.</span>';
  }
}

if (selectVaultTarget) {
  selectVaultTarget.addEventListener('change', onVaultTargetChange);
}

if (btnOpenVaultModal) {
  btnOpenVaultModal.addEventListener('click', () => openVaultModal());
}

if (btnCloseVaultModal) {
  btnCloseVaultModal.addEventListener('click', () => vaultModal.classList.add('hidden'));
}

// Add keys form submit
if (formAddKeys) {
  formAddKeys.addEventListener('submit', async (e) => {
    e.preventDefault();
    const targetKey = selectVaultTarget.value;
    const rawKeys = textareaNewKeys.value.trim();
    if (!targetKey || !rawKeys) {
      showToast('Inserisci almeno una chiave valida', 'error');
      return;
    }

    const selectedOpt = selectVaultTarget.options[selectVaultTarget.selectedIndex];
    const title = selectedOpt ? selectedOpt.dataset.title : '';
    const sku = selectedOpt ? selectedOpt.dataset.sku : '';

    btnAddKeysSubmit.disabled = true;
    btnAddKeysSubmit.textContent = '⏳ Caricamento...';

    try {
      const res = await fetch('/api/vault/keys/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetKey, keys: rawKeys, title, sku })
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Errore');

      showToast(`✅ Aggiunte ${data.data.addedCount} chiavi nel Vault!`, 'success');
      textareaNewKeys.value = '';
      state.vault = data.vault;
      updateVaultHeaderBadge();
      onVaultTargetChange();
      applyFilterAndRender();
    } catch (err) {
      showToast(`❌ ${err.message}`, 'error');
    } finally {
      btnAddKeysSubmit.disabled = false;
      btnAddKeysSubmit.textContent = '➕ Aggiungi al Vault';
    }
  });
}

// Delete Key
window.deleteVaultKey = async function(targetKey, keyId) {
  if (!confirm('Sei sicuro di voler eliminare questa chiave dal Vault?')) return;
  try {
    const res = await fetch('/api/vault/keys', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetKey, keyId })
    });
    const data = await res.json();
    if (data.success) {
      state.vault = data.vault;
      updateVaultHeaderBadge();
      onVaultTargetChange();
      showToast('Chiave eliminata', 'info');
    }
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  }
};

// Save Settings and Template
if (formSaveVaultSettings) {
  formSaveVaultSettings.addEventListener('submit', async (e) => {
    e.preventDefault();
    const targetKey = selectVaultTarget.value;
    const enabled = toggleVaultEnabled.checked;
    const autoShip = toggleVaultAutoShip.checked;
    const template = textareaMessageTemplate.value.trim();

    const selectedOpt = selectVaultTarget.options[selectVaultTarget.selectedIndex];
    const title = selectedOpt ? selectedOpt.dataset.title : '';
    const sku = selectedOpt ? selectedOpt.dataset.sku : '';

    btnSaveVaultSettings.disabled = true;
    btnSaveVaultSettings.textContent = '⏳ Salvataggio...';

    try {
      const res = await fetch('/api/vault/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetKey, enabled, autoShip, template, title, sku })
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Errore');

      showToast('✅ Impostazioni Key Vault salvate con successo!', 'success');
      state.vault = data.vault;
      updateVaultHeaderBadge();
      onVaultTargetChange();
      applyFilterAndRender();
    } catch (err) {
      showToast(`❌ ${err.message}`, 'error');
    } finally {
      btnSaveVaultSettings.disabled = false;
      btnSaveVaultSettings.textContent = '💾 Salva Template & Impostazioni';
    }
  });
}

// Check Orders Now
if (btnCheckOrdersNow) {
  btnCheckOrdersNow.addEventListener('click', async () => {
    btnCheckOrdersNow.disabled = true;
    btnCheckOrdersNow.textContent = '⏳ Scansione...';
    try {
      const res = await fetch('/api/vault/check-orders', { method: 'POST' });
      const data = await res.json();
      if (data.deliveredCount > 0) {
        showToast(`🎉 Consegnate automaticamente ${data.deliveredCount} licenze!`, 'success');
      } else {
        showToast('Nessun nuovo ordine da evadere al momento.', 'info');
      }
      await loadVaultSummary();
      await loadVaultHistory();
      onVaultTargetChange();
    } catch (err) {
      showToast(`❌ ${err.message}`, 'error');
    } finally {
      btnCheckOrdersNow.disabled = false;
      btnCheckOrdersNow.textContent = '🔄 Controlla Ordini Ora';
    }
  });
}

async function loadVaultHistory() {
  if (!vaultHistoryContainer) return;
  try {
    const res = await fetch('/api/vault/history');
    const data = await res.json();
    if (data.history && data.history.length > 0) {
      vaultHistoryContainer.innerHTML = `
        <table class="history-table">
          <thead>
            <tr>
              <th>Data</th>
              <th>Acquirente</th>
              <th>Articolo</th>
              <th>Chiave Inviata</th>
              <th>Stato</th>
            </tr>
          </thead>
          <tbody>
            ${data.history.map(h => `
              <tr>
                <td>${new Date(h.deliveredAt || h.processedAt).toLocaleString()}</td>
                <td><strong>${escapeHtml(h.buyerId)}</strong><br><span style="font-size:0.7rem; color:var(--text-muted);">#${escapeHtml(h.orderId)}</span></td>
                <td>${escapeHtml(h.title)}</td>
                <td><code style="color:#38bdf8;">${escapeHtml(h.keyUsed)}</code></td>
                <td>${h.messageSent ? '✅ Inviato' : '⚠️ Errore'} ${h.markedShipped ? '📦 Spedito' : ''}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    } else {
      vaultHistoryContainer.innerHTML = '<p style="color: var(--text-muted); font-size: 0.8rem; text-align: center; padding: 20px;">Nessun ordine evaso ancora.</p>';
    }
  } catch (e) {
    vaultHistoryContainer.innerHTML = '<p style="color: var(--text-muted); font-size: 0.8rem; text-align: center;">Errore caricamento storico.</p>';
  }
}

// Initial Boot
async function initApp() {
  await checkStatus();
  await loadVaultSummary();
  await loadListings();
}
initApp();

// Auto refresh status every 20s
setInterval(checkStatus, 20000);

