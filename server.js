const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const config = require('./config');
const ebayApi = require('./ebay_api');
const monitor = require('./monitor');
const rulesManager = require('./rules_manager');
const keysManager = require('./keys_manager');

const app = express();

app.use(cors());
app.use(express.json());

// Middleware per normalizzare i percorsi quando l'app è montata su una sottocartella cPanel (es. /ebay1/...)
app.use((req, res, next) => {
  const knownPrefixes = ['/api', '/style.css', '/app.js', '/manifest.json', '/sw.js', '/icons', '/favicon.ico'];
  for (const kp of knownPrefixes) {
    const idx = req.url.indexOf(kp);
    if (idx > 0) {
      req.url = req.url.substring(idx);
      break;
    }
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

const ENV_PATH = path.join(__dirname, '.env');

// ==========================================
// GESTIONE AUTENTICAZIONE E SESSIONI
// ==========================================
const activeSessions = new Set();

function generateAuthToken() {
  const token = crypto.randomBytes(32).toString('hex');
  activeSessions.add(token);
  return token;
}

function isValidToken(token) {
  if (!token) return false;
  return activeSessions.has(token);
}

function requireAuth(req, res, next) {
  const token = req.headers['x-auth-token'] || req.query.token;
  if (!isValidToken(token)) {
    return res.status(401).json({ success: false, error: 'Non autorizzato. Inserisci la password.' });
  }
  next();
}

/**
 * POST /api/auth/login
 * Verifica la password e restituisce un token di sessione
 */
app.post('/api/auth/login', (req, res) => {
  const { password } = req.body;
  const currentPassword = config.adminPassword || 'admin123';

  if (!password || String(password).trim() !== String(currentPassword).trim()) {
    return res.status(401).json({ success: false, error: 'Password errata. Riprova.' });
  }

  const token = generateAuthToken();
  res.json({ success: true, token, message: 'Accesso eseguito con successo!' });
});

/**
 * GET /api/auth/verify
 * Verifica se il token salvato nel browser è ancora valido
 */
app.get('/api/auth/verify', (req, res) => {
  const token = req.headers['x-auth-token'] || req.query.token;
  const valid = isValidToken(token);
  res.json({ success: valid, authenticated: valid });
});

/**
 * POST /api/auth/change-password
 */
app.post('/api/auth/change-password', requireAuth, (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.trim().length < 4) {
    return res.status(400).json({ success: false, error: 'La password deve contenere almeno 4 caratteri' });
  }

  config.adminPassword = newPassword.trim();
  updateEnvFile('ADMIN_PASSWORD', newPassword.trim());
  res.json({ success: true, message: 'Password aggiornata con successo!' });
});

/**
 * POST /api/auth/logout
 */
app.post('/api/auth/logout', (req, res) => {
  const token = req.headers['x-auth-token'];
  if (token) activeSessions.delete(token);
  res.json({ success: true });
});

/**
 * GET /api/status
 * Restituisce stato generale. Se non autenticato, restituisce solo info di salute per cron-job
 */
app.get('/api/status', async (req, res) => {
  const token = req.headers['x-auth-token'] || req.query.token;
  const isAuthenticated = isValidToken(token);

  if (!isAuthenticated) {
    // Risposta pubblica per cron-job.org / health-check senza dati sensibili
    return res.json({
      ok: true,
      service: 'eBay Inventory Automation',
      status: 'active',
      authenticated: false,
      timestamp: new Date().toISOString()
    });
  }

  const isConfigured = config.isConfigured();
  const monitorStatus = monitor.getStatus();

  let ebayStatus = { ok: false, message: 'Non configurato' };
  if (isConfigured) {
    try {
      const connTest = await ebayApi.testConnection();
      ebayStatus = connTest.ok
        ? { ok: true, ebayTime: connTest.ebayTime, env: connTest.environment }
        : { ok: false, message: connTest.error };
    } catch (err) {
      ebayStatus = { ok: false, message: err.message };
    }
  }

  res.json({
    ok: true,
    authenticated: true,
    isConfigured,
    environment: config.envName,
    siteId: config.siteId,
    ebay: ebayStatus,
    monitor: monitorStatus,
    rulesSummary: {
      customRulesCount: Object.keys(rulesManager.data.items).length,
      pendingCount: Object.keys(monitorStatus.pendingQueue).length
    }
  });
});

// Tutte le rotte API successive richiedono autenticazione
app.use('/api', requireAuth);

/**
 * GET /api/config
 * Recupera la configurazione attuale (per il form onboarding/impostazioni)
 */
app.get('/api/config', (req, res) => {
  res.json({
    isConfigured: config.isConfigured(),
    clientId: config.clientId ? (config.clientId.includes('Inserisci_') ? '' : config.clientId) : '',
    clientSecret: config.clientSecret ? (config.clientSecret.includes('Inserisci_') ? '' : config.clientSecret) : '',
    refreshToken: config.refreshToken ? (config.refreshToken.includes('Inserisci_') ? '' : config.refreshToken) : '',
    env: config.envName,
    siteId: config.siteId,
    port: config.port,
    autoRestockInterval: config.autoRestockInterval
  });
});

/**
 * POST /api/config/test
 * Testa le credenziali fornite prima di salvarle
 */
app.post('/api/config/test', async (req, res) => {
  const { clientId, clientSecret, refreshToken, env, siteId } = req.body;
  if (!clientId || !clientSecret || !refreshToken) {
    return res.status(400).json({ success: false, error: 'Compilare tutti i campi credenziali obbligatori' });
  }

  const isSandbox = (env || 'PRODUCTION').toUpperCase() === 'SANDBOX';
  const oauthUrl = isSandbox
    ? 'https://api.sandbox.ebay.com/identity/v1/oauth2/token'
    : 'https://api.ebay.com/identity/v1/oauth2/token';
  const tradingUrl = isSandbox
    ? 'https://api.sandbox.ebay.com/ws/api.dll'
    : 'https://api.ebay.com/ws/api.dll';

  const axios = require('axios');
  const xml2js = require('xml2js');

  try {
    const authHeader = Buffer.from(`${clientId.trim()}:${clientSecret.trim()}`).toString('base64');
    const params = new URLSearchParams();
    params.append('grant_type', 'refresh_token');
    params.append('refresh_token', refreshToken.trim());

    const tokenRes = await axios.post(oauthUrl, params.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${authHeader}`
      },
      timeout: 15000
    });

    const accessToken = tokenRes.data.access_token;
    if (!accessToken) throw new Error('Access Token non ricevuto da eBay');

    // Test rapido con GetMyeBaySelling (prima pagina, 1 inserzione)
    const testXml = `<?xml version="1.0" encoding="utf-8"?>
<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ActiveList>
    <Pagination>
      <EntriesPerPage>1</EntriesPerPage>
      <PageNumber>1</PageNumber>
    </Pagination>
  </ActiveList>
  <DetailLevel>ReturnAll</DetailLevel>
</GetMyeBaySellingRequest>`;

    const apiRes = await axios.post(tradingUrl, testXml, {
      headers: {
        'X-EBAY-API-SITEID': siteId || '101',
        'X-EBAY-API-COMPATIBILITY-LEVEL': '1349',
        'X-EBAY-API-CALL-NAME': 'GetMyeBaySelling',
        'X-EBAY-API-IAF-TOKEN': accessToken,
        'X-EBAY-API-APP-NAME': clientId.trim(),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Content-Type': 'text/xml; charset=utf-8'
      },
      timeout: 15000
    });

    const parsed = await xml2js.parseStringPromise(apiRes.data, { explicitArray: false });
    const responseObj = parsed.GetMyeBaySellingResponse || parsed;

    if (responseObj.Ack === 'Success' || responseObj.Ack === 'Warning') {
      const activeList = responseObj.ActiveList || {};
      const totalEntries = activeList.PaginationResult?.TotalNumberOfEntries || '0';
      res.json({
        success: true,
        message: `Connessione a eBay verificata con successo! Inserzioni attive trovate: ${totalEntries}`,
        ebayTime: responseObj.Timestamp || new Date().toISOString()
      });
    } else {
      const errMsg = responseObj.Errors ? (responseObj.Errors.LongMessage || responseObj.Errors.ShortMessage) : 'Errore sconosciuto';
      res.status(400).json({ success: false, error: errMsg });
    }
  } catch (err) {
    const msg = err.response && err.response.data ? JSON.stringify(err.response.data) : err.message;
    res.status(400).json({ success: false, error: `Verifica fallita: ${msg}` });
  }
});

/**
 * POST /api/oauth/generate-auth-url
 * Genera l'URL per l'accesso e consenso venditore eBay
 */
app.post('/api/oauth/generate-auth-url', (req, res) => {
  const { clientId, ruName, env } = req.body;
  if (!clientId || !ruName) {
    return res.status(400).json({ success: false, error: 'Client ID e RuName sono obbligatori' });
  }

  const isSandbox = (env || 'PRODUCTION').toUpperCase() === 'SANDBOX';
  const baseUrl = isSandbox
    ? 'https://auth.sandbox.ebay.com/oauth2/authorize'
    : 'https://auth.ebay.com/oauth2/authorize';

  const scopes = [
    'https://api.ebay.com/oauth/api_scope',
    'https://api.ebay.com/oauth/api_scope/sell.inventory',
    'https://api.ebay.com/oauth/api_scope/sell.account'
  ].join(' ');

  const url = `${baseUrl}?client_id=${encodeURIComponent(clientId.trim())}&response_type=code&redirect_uri=${encodeURIComponent(ruName.trim())}&scope=${encodeURIComponent(scopes)}`;

  res.json({ success: true, authUrl: url });
});

/**
 * POST /api/oauth/exchange-code
 * Scambia il codice di autorizzazione ottenuto da eBay con il vero Refresh Token
 */
app.post('/api/oauth/exchange-code', async (req, res) => {
  const { code, clientId, clientSecret, ruName, env } = req.body;
  if (!code || !clientId || !clientSecret || !ruName) {
    return res.status(400).json({ success: false, error: 'Tutti i campi (code, clientId, clientSecret, ruName) sono obbligatori' });
  }

  const isSandbox = (env || 'PRODUCTION').toUpperCase() === 'SANDBOX';
  const oauthUrl = isSandbox
    ? 'https://api.sandbox.ebay.com/identity/v1/oauth2/token'
    : 'https://api.ebay.com/identity/v1/oauth2/token';

  const axios = require('axios');

  try {
    // Se l'utente incolla l'intero URL di reindirizzamento invece del solo codice:
    let cleanCode = code.trim();
    if (cleanCode.includes('code=')) {
      const match = cleanCode.match(/code=([^&]+)/);
      if (match) cleanCode = decodeURIComponent(match[1]);
    }

    const authHeader = Buffer.from(`${clientId.trim()}:${clientSecret.trim()}`).toString('base64');
    const params = new URLSearchParams();
    params.append('grant_type', 'authorization_code');
    params.append('code', cleanCode);
    params.append('redirect_uri', ruName.trim());

    const tokenRes = await axios.post(oauthUrl, params.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${authHeader}`
      },
      timeout: 15000
    });

    if (tokenRes.data && tokenRes.data.refresh_token) {
      res.json({
        success: true,
        refreshToken: tokenRes.data.refresh_token,
        accessToken: tokenRes.data.access_token,
        expiresIn: tokenRes.data.expires_in
      });
    } else {
      throw new Error('Refresh token non presente nella risposta di eBay');
    }
  } catch (err) {
    const msg = err.response && err.response.data ? JSON.stringify(err.response.data) : err.message;
    res.status(400).json({ success: false, error: `Scambio codice fallito: ${msg}` });
  }
});

/**
 * POST /api/config/save
 * Salva la configurazione nel file .env e aggiorna i moduli in memoria
 */
app.post('/api/config/save', async (req, res) => {
  try {
    const { clientId, clientSecret, refreshToken, env, siteId, port, autoRestockInterval, adminPassword } = req.body;

    if (!clientId || !clientSecret || !refreshToken) {
      return res.status(400).json({ success: false, error: 'Tutti i campi credenziali sono obbligatori' });
    }

    const cleanClientId = clientId.trim();
    const cleanClientSecret = clientSecret.trim();
    const cleanRefreshToken = refreshToken.trim();
    const cleanEnv = (env || 'PRODUCTION').toUpperCase();
    const cleanSiteId = siteId || '101';
    const cleanPort = port || '3000';
    const cleanInterval = autoRestockInterval || '15';
    const cleanPassword = (adminPassword && adminPassword.trim()) ? adminPassword.trim() : config.adminPassword;

    const envContent = `# ==========================================
# CONFIGURAZIONE CREDENZIALI EBAY API (Generato via Web App)
# ==========================================

EBAY_CLIENT_ID="${cleanClientId}"
EBAY_CLIENT_SECRET="${cleanClientSecret}"
EBAY_REFRESH_TOKEN="${cleanRefreshToken}"
EBAY_ENV=${cleanEnv}
EBAY_SITE_ID=${cleanSiteId}

# ==========================================
# CONFIGURAZIONE SERVER & SICUREZZA
# ==========================================

PORT=${cleanPort}
AUTO_RESTOCK_INTERVAL_MINUTES=${cleanInterval}
ADMIN_PASSWORD="${cleanPassword}"
`;

    fs.writeFileSync(ENV_PATH, envContent, 'utf8');

    // Aggiorna variabili d'ambiente in esecuzione
    process.env.EBAY_CLIENT_ID = cleanClientId;
    process.env.EBAY_CLIENT_SECRET = cleanClientSecret;
    process.env.EBAY_REFRESH_TOKEN = cleanRefreshToken;
    process.env.EBAY_ENV = cleanEnv;
    process.env.EBAY_SITE_ID = cleanSiteId;
    process.env.PORT = cleanPort;
    process.env.AUTO_RESTOCK_INTERVAL_MINUTES = cleanInterval;
    process.env.ADMIN_PASSWORD = cleanPassword;

    // Aggiorna oggetto config
    config.clientId = cleanClientId;
    config.clientSecret = cleanClientSecret;
    config.refreshToken = cleanRefreshToken;
    config.isSandbox = cleanEnv === 'SANDBOX';
    config.envName = cleanEnv;
    config.siteId = cleanSiteId;
    config.autoRestockInterval = parseInt(cleanInterval, 10);
    config.adminPassword = cleanPassword;
    config.oauthUrl = config.isSandbox
      ? 'https://api.sandbox.ebay.com/identity/v1/oauth2/token'
      : 'https://api.ebay.com/identity/v1/oauth2/token';
    config.tradingApiUrl = config.isSandbox
      ? 'https://api.sandbox.ebay.com/ws/api.dll'
      : 'https://api.ebay.com/ws/api.dll';

    monitor.addLog('SUCCESS', 'Credenziali eBay aggiornate e salvate nel file .env con successo.');

    // Avvia automaticamente il monitor
    if (!monitor.isRunning) {
      monitor.start(config.autoRestockInterval);
    }

    res.json({
      success: true,
      message: 'Configurazione salvata con successo nel file .env!'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: `Errore salvataggio file .env: ${error.message}` });
  }
});

/**
 * GET /api/listings
 */
app.get('/api/listings', async (req, res) => {
  try {
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '100', 10);
    const search = (req.query.search || '').trim().toLowerCase();
    const zeroOnly = req.query.zeroOnly === 'true';

    const data = await ebayApi.getActiveListings(page, limit);
    const pendingQueue = rulesManager.getPendingQueueWithCountdown();

    let items = data.items.map(item => {
      const rule = rulesManager.getItemRule(item.itemId);
      const pendingInfo = pendingQueue[item.itemId] || null;
      return {
        ...item,
        rule,
        pending: pendingInfo
      };
    });

    if (zeroOnly) {
      items = items.filter(item => item.quantityAvailable <= 0);
    }

    if (search) {
      items = items.filter(item => 
        item.title.toLowerCase().includes(search) ||
        item.itemId.toLowerCase().includes(search) ||
        item.sku.toLowerCase().includes(search)
      );
    }

    const totalActive = data.items.length;
    const totalZero = data.items.filter(i => i.quantityAvailable <= 0).length;
    const totalPending = Object.keys(pendingQueue).length;

    res.json({
      success: true,
      items,
      stats: {
        totalActive,
        totalZero,
        totalPending,
        filteredCount: items.length
      },
      pagination: data.pagination
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/update-quantity
 */
app.post('/api/update-quantity', async (req, res) => {
  try {
    const { itemId, quantity, sku, quantitySold, title, variationSpecifics } = req.body;

    if (!itemId && !sku) {
      return res.status(400).json({ success: false, error: 'Specificare Item ID o SKU' });
    }

    const targetQty = parseInt(quantity, 10);
    if (isNaN(targetQty) || targetQty < 0) {
      return res.status(400).json({ success: false, error: 'Quantità non valida (deve essere >= 0)' });
    }

    const result = await ebayApi.updateItemQuantity(itemId, targetQty, sku, quantitySold, variationSpecifics);

    if (result.success) {
      if (itemId) rulesManager.removeFromPending(itemId);
      monitor.addLog('SUCCESS', `Modifica manuale: "${title || itemId}" impostata a ${targetQty}`, {
        itemId, sku, newQty: targetQty
      });
      res.json({ success: true, data: result });
    } else {
      monitor.addLog('ERROR', `Errore modifica manuale "${title || itemId}": ${result.error}`);
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/update-price
 * Modifica il prezzo di vendita di un'inserzione su eBay
 */
app.post('/api/update-price', async (req, res) => {
  try {
    const { itemId, price, currency, sku, title, variationSpecifics } = req.body;

    if (!itemId && !sku) {
      return res.status(400).json({ success: false, error: 'Specificare Item ID o SKU' });
    }

    const priceNum = parseFloat(price);
    if (isNaN(priceNum) || priceNum <= 0) {
      return res.status(400).json({ success: false, error: 'Prezzo non valido (deve essere maggiore di 0)' });
    }

    const result = await ebayApi.updateItemPrice(itemId, priceNum, currency || 'EUR', sku, variationSpecifics);

    if (result.success) {
      monitor.addLog('SUCCESS', `Modifica prezzo: "${title || itemId}" aggiornato a ${result.newPrice} ${result.currency}`, {
        itemId, sku, newPrice: result.newPrice
      });
      res.json({ success: true, data: result });
    } else {
      monitor.addLog('ERROR', `Errore modifica prezzo "${title || itemId}": ${result.error}`);
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/auto-restock/run
 */
app.post('/api/auto-restock/run', async (req, res) => {
  try {
    const forceAll = req.body.forceAll === true;
    const specificItemId = req.body.itemId || null;
    const result = await monitor.runCheck(forceAll, specificItemId);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Funzione di utilità per aggiornare una singola variabile nel file .env
 */
function updateEnvFile(key, value) {
  try {
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
      let content = fs.readFileSync(envPath, 'utf8');
      const regex = new RegExp(`^${key}=.*$`, 'm');
      if (regex.test(content)) {
        content = content.replace(regex, `${key}=${value}`);
      } else {
        content += `\n${key}=${value}\n`;
      }
      fs.writeFileSync(envPath, content, 'utf8');
    }
  } catch (e) {
    console.error('Errore aggiornamento .env:', e.message);
  }
}

/**
 * POST /api/auto-restock/toggle
 */
app.post('/api/auto-restock/toggle', (req, res) => {
  try {
    const { enabled, intervalMinutes } = req.body;
    const interval = intervalMinutes ? parseInt(intervalMinutes, 10) : config.autoRestockInterval;
    
    if (interval) {
      config.autoRestockInterval = interval;
      updateEnvFile('AUTO_RESTOCK_INTERVAL_MINUTES', interval);
    }

    let status = enabled
      ? monitor.start(interval)
      : monitor.stop();

    res.json({ success: true, monitor: status });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/auto-restock/interval
 * Salva il nuovo intervallo di scansione e aggiorna il monitor
 */
app.post('/api/auto-restock/interval', (req, res) => {
  try {
    const intervalMinutes = parseInt(req.body.intervalMinutes, 10);
    if (isNaN(intervalMinutes) || intervalMinutes < 1) {
      return res.status(400).json({ success: false, error: 'Intervallo non valido' });
    }

    config.autoRestockInterval = intervalMinutes;
    updateEnvFile('AUTO_RESTOCK_INTERVAL_MINUTES', intervalMinutes);

    let monitorStatus = monitor.getStatus();
    if (monitorStatus.isRunning) {
      monitorStatus = monitor.start(intervalMinutes);
    } else {
      monitor.intervalMinutes = intervalMinutes;
    }

    monitor.addLog('INFO', `Intervallo monitor aggiornato a ${intervalMinutes} minuti.`);
    res.json({ success: true, intervalMinutes, monitor: monitorStatus });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/rules
 */
app.get('/api/rules', (req, res) => {
  res.json({
    success: true,
    data: rulesManager.getAllRules()
  });
});

/**
 * POST /api/rules/set
 */
app.post('/api/rules/set', (req, res) => {
  try {
    const { itemId, enabled, delayMinutes, targetQty, title, sku } = req.body;
    if (!itemId) {
      return res.status(400).json({ success: false, error: 'ItemID richiesto' });
    }

    const rule = rulesManager.setItemRule(itemId, {
      enabled: enabled !== undefined ? enabled : true,
      delayMinutes: parseInt(delayMinutes, 10) || 0,
      targetQty: parseInt(targetQty, 10) || 1,
      title,
      sku
    });

    monitor.addLog('INFO', `Regola salvata per "${title || itemId}": ritardo ${rule.delayMinutes} min, quantità ${rule.targetQty}.`);

    res.json({
      success: true,
      rule,
      pendingQueue: rulesManager.getPendingQueueWithCountdown()
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/rules/delete
 */
app.post('/api/rules/delete', (req, res) => {
  try {
    const { itemId } = req.body;
    rulesManager.deleteItemRule(itemId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/rules/global
 */
app.post('/api/rules/global', (req, res) => {
  try {
    const updated = rulesManager.setGlobal(req.body);
    res.json({ success: true, global: updated });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/logs
 */
app.get('/api/logs', (req, res) => {
  res.json({ logs: monitor.logs });
});

// ==========================================
// ROTTE KEY VAULT & DIGITAL DELIVERY
// ==========================================

/**
 * GET /api/vault/summary
 * Restituisce il riepilogo di tutti gli articoli configurati nel Key Vault
 */
app.get('/api/vault/summary', (req, res) => {
  try {
    const summary = keysManager.getAllVaultSummary();
    res.json({ success: true, vault: summary });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/vault/keys/add
 * Aggiunge chiavi a un prodotto/variante
 */
app.post('/api/vault/keys/add', (req, res) => {
  try {
    const { targetKey, keys, title, sku, supplierOrderId } = req.body;
    if (!targetKey) {
      return res.status(400).json({ success: false, error: 'targetKey obbligatorio' });
    }

    let keysArray = [];
    if (Array.isArray(keys)) {
      keysArray = keys;
    } else if (typeof keys === 'string') {
      keysArray = keys.split('\n').map(k => k.trim()).filter(Boolean);
    }

    if (!keysArray.length) {
      return res.status(400).json({ success: false, error: 'Nessuna chiave valida inserita' });
    }

    const result = keysManager.addKeys(targetKey, keysArray, title, sku, supplierOrderId);
    const supplierInfoText = supplierOrderId ? ` [Ordine Fornitore: #${supplierOrderId}]` : '';
    monitor.addLog('INFO', `Aggiunte ${result.addedCount} chiavi nel Vault per "${title || targetKey}"${supplierInfoText} (Totale disp: ${result.totalAvailable}).`);

    res.json({
      success: true,
      data: result,
      vault: keysManager.getAllVaultSummary()
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/vault/keys
 * Elimina una specifica chiave non utilizzata
 */
app.delete('/api/vault/keys', (req, res) => {
  try {
    const { targetKey, keyId } = req.body;
    if (!targetKey || !keyId) {
      return res.status(400).json({ success: false, error: 'targetKey e keyId richiesti' });
    }

    const deleted = keysManager.deleteKey(targetKey, keyId);
    res.json({ success: deleted, vault: keysManager.getAllVaultSummary() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/vault/keys/transfer
 * Sposta chiavi disponibili da una inserzione (anche chiusa) a un'altra
 */
app.post('/api/vault/keys/transfer', (req, res) => {
  try {
    const { sourceTargetKey, destTargetKey, keyIds, destTitle, destSku } = req.body;
    if (!sourceTargetKey || !destTargetKey) {
      return res.status(400).json({ success: false, error: 'sourceTargetKey e destTargetKey sono obbligatori' });
    }

    const result = keysManager.transferKeys(sourceTargetKey, destTargetKey, keyIds, destTitle, destSku);
    monitor.addLog('INFO', `Trasferite ${result.transferredCount} chiavi da "${sourceTargetKey}" a "${destTargetKey}".`);

    res.json({
      success: true,
      data: result,
      vault: keysManager.getAllVaultSummary()
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/vault/settings
 * Salva impostazioni di consegna, template e abilitazione per un prodotto
 */
app.post('/api/vault/settings', (req, res) => {
  try {
    const { targetKey, enabled, autoShip, template, title, sku } = req.body;
    if (!targetKey) {
      return res.status(400).json({ success: false, error: 'targetKey obbligatorio' });
    }

    const updated = keysManager.setSettings(targetKey, {
      enabled,
      autoShip,
      template,
      title,
      sku
    });

    monitor.addLog('INFO', `Impostazioni Key Vault aggiornate per "${title || targetKey}" (Delivery: ${enabled ? 'ATTIVO' : 'Disattivato'}).`);

    res.json({
      success: true,
      data: updated,
      vault: keysManager.getAllVaultSummary()
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/vault/history
 * Restituisce lo storico delle chiavi consegnate
 */
app.get('/api/vault/history', (req, res) => {
  try {
    const history = keysManager.getDeliveryHistory();
    res.json({ success: true, history });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/vault/check-orders
 * Esegue manualmente la scansione degli ordini per il Digital Delivery
 */
app.post('/api/vault/check-orders', async (req, res) => {
  try {
    const deliveredCount = await monitor.checkAndDeliverOrders();
    res.json({ success: true, deliveredCount });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/system/update
 * Esegue il pull del codice da GitHub e ricarica l'applicazione Passenger
 */
app.post('/api/system/update', requireAuth, (req, res) => {
  const { exec } = require('child_process');
  try {
    monitor.addLog('INFO', '🔄 Avviato aggiornamento del codice da GitHub...');

    // Salva un backup di sicurezza dei file di dati prima del pull
    const backupDir = path.join(__dirname, 'backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

    const dataFiles = ['keys_vault.json', 'processed_orders.json', 'restock_rules.json', '.env'];
    for (const f of dataFiles) {
      const src = path.join(__dirname, f);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(backupDir, `${f}.bak`));
      }
    }

    const token = (req.body.githubToken || process.env.GITHUB_TOKEN || config.githubToken || '').trim();
    let repoUrl = 'https://github.com/nziria/ebayinventory.git';
    if (token) {
      repoUrl = `https://${token}@github.com/nziria/ebayinventory.git`;
    }

    // Comando git fetch + reset --hard (elimina qualsiasi conflitto di merge garantendo l'aggiornamento pulito del codice)
    const gitCmd = `git config --global --add safe.directory "${__dirname.replace(/\\/g, '/')}" && git fetch "${repoUrl}" main && git reset --hard FETCH_HEAD`;

    exec(gitCmd, { cwd: __dirname }, (error, stdout, stderr) => {
      // Ripristina sempre e comunque i file di dati e credenziali dai backup
      for (const f of dataFiles) {
        const bak = path.join(backupDir, `${f}.bak`);
        const target = path.join(__dirname, f);
        if (fs.existsSync(bak)) {
          fs.copyFileSync(bak, target);
        }
      }

      // Segnala a Phusion Passenger su cPanel di riavviare l'app
      try {
        const tmpDir = path.join(__dirname, 'tmp');
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
        fs.writeFileSync(path.join(tmpDir, 'restart.txt'), String(Date.now()));
      } catch (restartErr) {
        console.error('Errore creazione restart.txt:', restartErr.message);
      }

      if (error) {
        console.error('Errore git pull:', error.message, stderr);
        monitor.addLog('WARN', `Aggiornamento git: ${error.message || stderr}`);
        let hint = '';
        if (stderr && (stderr.includes('could not read Username') || stderr.includes('Authentication failed'))) {
          hint = ' 👉 Il repository GitHub è Privato: per aggiornare con 1 click senza password, imposta il repository come "Public" su GitHub (Settings -> Change repository visibility -> Make public).';
        }
        return res.json({
          success: false,
          error: `Errore durante il download da GitHub: ${stderr || error.message}.${hint}`,
          output: stdout
        });
      }

      monitor.addLog('SUCCESS', '✅ Codice aggiornato con successo da GitHub! Riavvio completato.');
      res.json({
        success: true,
        message: 'Aggiornamento completato con successo da GitHub! Il server si è riavviato.',
        output: stdout
      });
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Fallback SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = config.port || process.env.PORT || 3000;
const listenArgs = (!isNaN(Number(PORT))) ? [Number(PORT), '0.0.0.0'] : [PORT];

app.listen(...listenArgs, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 Server Gestione Inventario eBay avviato con successo!`);
  console.log(`📱 In ascolto su: ${PORT}`);
  console.log(`🌐 Ambiente: ${config.envName} (Sito ID: ${config.siteId})`);
  console.log(`======================================================\n`);

  // Avvio automatico del Monitor Auto-Restock di default se configurato
  if (config.isConfigured()) {
    const interval = config.autoRestockInterval || 15;
    monitor.start(interval);
    console.log(`🤖 Monitor Auto-Restock ATTIVATO di default (scansione ogni ${interval} min).\n`);
  }
});
