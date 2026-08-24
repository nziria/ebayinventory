const fs = require('fs');
const path = require('path');

const VAULT_FILE = path.join(__dirname, 'keys_vault.json');
const PROCESSED_ORDERS_FILE = path.join(__dirname, 'processed_orders.json');

const DEFAULT_MESSAGE_TEMPLATE = `Dear Customer, 

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

class KeysManager {
  constructor() {
    this.vault = {}; // { [targetKey]: { enabled: true, autoShip: true, template: '', title: '', sku: '', keys: [ { id, code, status: 'available'|'delivered', addedAt, deliveredAt, orderId, buyerId } ] } }
    this.processedOrders = {}; // { [orderKey]: { orderId, lineItemId, buyerId, itemId, keyUsed, deliveredAt } }
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(VAULT_FILE)) {
        this.vault = JSON.parse(fs.readFileSync(VAULT_FILE, 'utf8'));
      } else {
        this.saveVault();
      }
    } catch (err) {
      console.error('Errore caricamento keys_vault.json:', err.message);
      this.vault = {};
    }

    try {
      if (fs.existsSync(PROCESSED_ORDERS_FILE)) {
        this.processedOrders = JSON.parse(fs.readFileSync(PROCESSED_ORDERS_FILE, 'utf8'));
      } else {
        this.saveProcessedOrders();
      }
    } catch (err) {
      console.error('Errore caricamento processed_orders.json:', err.message);
      this.processedOrders = {};
    }
  }

  saveVault() {
    try {
      fs.writeFileSync(VAULT_FILE, JSON.stringify(this.vault, null, 2), 'utf8');
    } catch (err) {
      console.error('Errore salvataggio keys_vault.json:', err.message);
    }
  }

  saveProcessedOrders() {
    try {
      fs.writeFileSync(PROCESSED_ORDERS_FILE, JSON.stringify(this.processedOrders, null, 2), 'utf8');
    } catch (err) {
      console.error('Errore salvataggio processed_orders.json:', err.message);
    }
  }

  /**
   * Genera la chiave identificativa (ItemID o ItemID + NomeVariante)
   */
  getTargetKey(itemId, varName = null) {
    if (!varName) return String(itemId);
    return `${itemId}::${varName.trim().toLowerCase()}`;
  }

  /**
   * Recupera o inizializza l'oggetto di configurazione per un prodotto/variante
   */
  getOrCreateItemVault(targetKey, title = '', sku = '') {
    if (!this.vault[targetKey]) {
      this.vault[targetKey] = {
        targetKey,
        title: title || targetKey,
        sku: sku || '',
        enabled: false,
        autoShip: true,
        template: DEFAULT_MESSAGE_TEMPLATE,
        keys: [],
        updatedAt: new Date().toISOString()
      };
      this.saveVault();
    }
    return this.vault[targetKey];
  }

  /**
   * Restituisce tutti i dati del Vault formattati con contatori
   */
  getAllVaultSummary() {
    const summary = {};
    for (const [key, item] of Object.entries(this.vault)) {
      if (key.startsWith('_')) continue;
      const keys = item.keys || [];
      const available = keys.filter(k => k.status === 'available');
      const delivered = keys.filter(k => k.status === 'delivered');

      summary[key] = {
        targetKey: key,
        title: item.title,
        sku: item.sku,
        enabled: item.enabled,
        autoShip: item.autoShip !== false,
        template: item.template || DEFAULT_MESSAGE_TEMPLATE,
        totalKeys: keys.length,
        availableCount: available.length,
        deliveredCount: delivered.length,
        availableKeys: available.map(k => ({
          id: k.id,
          code: k.code,
          supplierOrderId: k.supplierOrderId || '',
          addedAt: k.addedAt
        })),
        deliveredKeys: delivered.map(k => ({
          id: k.id,
          code: k.code,
          supplierOrderId: k.supplierOrderId || '',
          deliveredAt: k.deliveredAt,
          orderId: k.orderId,
          buyerId: k.buyerId
        }))
      };
    }
    return summary;
  }

  /**
   * Genera il prossimo codice di spedizione progressivo (es. PLEASEREADEBAYMESSAGE82)
   */
  getNextTrackingNumber() {
    if (!this.vault._meta) {
      this.vault._meta = {
        carrier: 'UPS',
        trackingPrefix: 'PLEASEREADEBAYMESSAGE',
        lastCounter: 81
      };
    }

    let currentMax = parseInt(this.vault._meta.lastCounter, 10) || 81;

    // Ispeziona gli ordini già registrati per garantire che il progressivo non torni mai indietro
    for (const po of Object.values(this.processedOrders || {})) {
      if (po.trackingNumber) {
        const match = String(po.trackingNumber).match(/\d+$/);
        if (match) {
          const num = parseInt(match[0], 10);
          if (!isNaN(num) && num > currentMax) {
            currentMax = num;
          }
        }
      }
    }

    this.vault._meta.lastCounter = currentMax + 1;
    this.saveVault();

    const carrier = this.vault._meta.carrier || 'UPS';
    const trackingNumber = `${this.vault._meta.trackingPrefix || 'PLEASEREADEBAYMESSAGE'}${this.vault._meta.lastCounter}`;
    return {
      carrier,
      trackingNumber,
      counter: this.vault._meta.lastCounter
    };
  }

  getTrackingConfig() {
    if (!this.vault._meta) {
      this.vault._meta = {
        carrier: 'UPS',
        trackingPrefix: 'PLEASEREADEBAYMESSAGE',
        lastCounter: 81
      };
    }
    return this.vault._meta;
  }

  /**
   * Aggiunge chiavi in blocco a un prodotto/variante con associazione all'ordine fornitore
   */
  addKeys(targetKey, keysArray, title = '', sku = '', batchSupplierOrderId = '') {
    const itemVault = this.getOrCreateItemVault(targetKey, title, sku);
    const added = [];
    const now = new Date().toISOString();

    for (const rawLine of keysArray) {
      let lineStr = String(rawLine).trim();
      if (!lineStr) continue;

      let code = lineStr;
      let lineSupplierOrderId = String(batchSupplierOrderId || '').trim();

      // Supporta formato separato da virgola, punto e virgola, tab o pipe: "KEY, 45678" oppure "KEY | 45678"
      if (/[,;\t|]/.test(lineStr)) {
        const parts = lineStr.split(/[,;\t|]+/).map(p => p.trim()).filter(Boolean);
        if (parts.length >= 2) {
          code = parts[0];
          lineSupplierOrderId = parts[1];
        }
      }

      if (!code) continue;

      // Evita duplicati identici tra le chiavi ancora disponibili
      const exists = itemVault.keys.some(k => k.code === code && k.status === 'available');
      if (!exists) {
        const keyObj = {
          id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
          code,
          supplierOrderId: lineSupplierOrderId,
          status: 'available',
          addedAt: now
        };
        itemVault.keys.push(keyObj);
        added.push(keyObj);
      }
    }

    itemVault.updatedAt = now;
    if (title) itemVault.title = title;
    if (sku) itemVault.sku = sku;
    this.saveVault();

    return {
      addedCount: added.length,
      totalAvailable: itemVault.keys.filter(k => k.status === 'available').length,
      added
    };
  }

  /**
   * Elimina una chiave specifica non ancora utilizzata
   */
  deleteKey(targetKey, keyId) {
    const itemVault = this.vault[targetKey];
    if (!itemVault) return false;

    const initialLen = itemVault.keys.length;
    itemVault.keys = itemVault.keys.filter(k => k.id !== keyId);
    if (itemVault.keys.length !== initialLen) {
      this.saveVault();
      return true;
    }
    return false;
  }

  /**
   * Aggiorna le impostazioni del prodotto/variante
   */
  setSettings(targetKey, { enabled, autoShip, template, title, sku }) {
    const itemVault = this.getOrCreateItemVault(targetKey, title, sku);
    if (enabled !== undefined) itemVault.enabled = Boolean(enabled);
    if (autoShip !== undefined) itemVault.autoShip = Boolean(autoShip);
    if (template !== undefined) itemVault.template = template || DEFAULT_MESSAGE_TEMPLATE;
    if (title) itemVault.title = title;
    if (sku) itemVault.sku = sku;
    itemVault.updatedAt = new Date().toISOString();
    this.saveVault();
    return itemVault;
  }

  /**
   * Conta quante chiavi disponibili ci sono
   */
  getAvailableKeysCount(targetKey) {
    const itemVault = this.vault[targetKey];
    if (!itemVault || !itemVault.keys) return 0;
    return itemVault.keys.filter(k => k.status === 'available').length;
  }

  /**
   * Verifica se il Digital Delivery è attivo per un prodotto
   */
  isDigitalDeliveryEnabled(targetKey) {
    const itemVault = this.vault[targetKey];
    return Boolean(itemVault && itemVault.enabled);
  }

  /**
   * Preleva e consuma una chiave per un ordine
   */
  consumeKey(targetKey, { orderId, buyerId }) {
    const itemVault = this.vault[targetKey];
    if (!itemVault || !itemVault.keys) return null;

    const availableKey = itemVault.keys.find(k => k.status === 'available');
    if (!availableKey) return null;

    availableKey.status = 'delivered';
    availableKey.deliveredAt = new Date().toISOString();
    availableKey.orderId = orderId || 'N/D';
    availableKey.buyerId = buyerId || 'N/D';

    this.saveVault();
    return availableKey;
  }

  /**
   * Verifica se un ordine è già stato evaso
   */
  isOrderProcessed(orderKey) {
    return Boolean(this.processedOrders[orderKey]);
  }

  /**
   * Registra un ordine come evaso con successo
   */
  markOrderProcessed(orderKey, data) {
    this.processedOrders[orderKey] = {
      ...data,
      processedAt: new Date().toISOString()
    };
    this.saveProcessedOrders();
  }

  /**
   * Compila il template del messaggio sostituendo i placeholder
   */
  formatMessage(template, { key, productName, buyerName, orderId }) {
    let tpl = template || DEFAULT_MESSAGE_TEMPLATE;
    tpl = tpl.replace(/\{KEY\}/gi, key || '');
    tpl = tpl.replace(/\{PRODUCT_NAME\}/gi, productName || 'Item');
    tpl = tpl.replace(/\{BUYER_NAME\}/gi, buyerName || 'Customer');
    tpl = tpl.replace(/\{ORDER_ID\}/gi, orderId || '');
    return tpl;
  }

  getDeliveryHistory(limit = 100) {
    return Object.values(this.processedOrders)
      .sort((a, b) => new Date(b.processedAt) - new Date(a.processedAt))
      .slice(0, limit);
  }
}

module.exports = new KeysManager();
