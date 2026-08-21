const fs = require('fs');
const path = require('path');

const RULES_FILE = path.join(__dirname, 'restock_rules.json');

class RulesManager {
  constructor() {
    this.data = {
      global: {
        defaultDelayMinutes: 0, // 0 = immediato
        defaultTargetQty: 1,
        autoRestockEnabled: true
      },
      items: {}, // { itemId: { enabled: true, delayMinutes: 10, targetQty: 1, title: '', sku: '', updatedAt: '' } }
      pendingQueue: {} // { itemId: { detectedAt: '', scheduledAt: '', targetQty: 1, delayMinutes: 10, title: '', sku: '' } }
    };
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(RULES_FILE)) {
        const raw = fs.readFileSync(RULES_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        this.data = {
          global: { ...this.data.global, ...(parsed.global || {}) },
          items: parsed.items || {},
          pendingQueue: parsed.pendingQueue || {}
        };
      } else {
        this.save();
      }
    } catch (err) {
      console.error('Errore nel caricamento di restock_rules.json:', err.message);
    }
  }

  save() {
    try {
      fs.writeFileSync(RULES_FILE, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (err) {
      console.error('Errore nel salvataggio di restock_rules.json:', err.message);
    }
  }

  getGlobal() {
    return this.data.global;
  }

  setGlobal(settings) {
    this.data.global = { ...this.data.global, ...settings };
    this.save();
    return this.data.global;
  }

  getItemRule(itemId) {
    if (this.data.items[itemId]) {
      return this.data.items[itemId];
    }
    return {
      enabled: this.data.global.autoRestockEnabled,
      delayMinutes: this.data.global.defaultDelayMinutes,
      targetQty: this.data.global.defaultTargetQty,
      isDefault: true
    };
  }

  setItemRule(itemId, { enabled = true, delayMinutes = 0, targetQty = 1, title = '', sku = '' }) {
    this.data.items[itemId] = {
      enabled: Boolean(enabled),
      delayMinutes: parseInt(delayMinutes, 10) || 0,
      targetQty: parseInt(targetQty, 10) || 1,
      title: title || '',
      sku: sku || '',
      updatedAt: new Date().toISOString()
    };
    this.save();
    return this.data.items[itemId];
  }

  deleteItemRule(itemId) {
    if (this.data.items[itemId]) {
      delete this.data.items[itemId];
      this.save();
      return true;
    }
    return false;
  }

  getAllRules() {
    return {
      global: this.data.global,
      items: this.data.items,
      pendingQueue: this.getPendingQueueWithCountdown()
    };
  }

  // Gestione Coda di Attesa
  addToPending(item, delayMinutes, targetQty = 1) {
    const now = Date.now();
    const delayMs = (parseInt(delayMinutes, 10) || 0) * 60 * 1000;
    const scheduledAtTime = now + delayMs;

    this.data.pendingQueue[item.itemId] = {
      itemId: item.itemId,
      sku: item.sku || '',
      title: item.title || '',
      detectedAt: new Date(now).toISOString(),
      scheduledAt: new Date(scheduledAtTime).toISOString(),
      scheduledAtMs: scheduledAtTime,
      delayMinutes: parseInt(delayMinutes, 10) || 0,
      targetQty: parseInt(targetQty, 10) || 1
    };
    this.save();
    return this.data.pendingQueue[item.itemId];
  }

  removeFromPending(itemId) {
    if (this.data.pendingQueue[itemId]) {
      delete this.data.pendingQueue[itemId];
      this.save();
      return true;
    }
    return false;
  }

  isPending(itemId) {
    return Boolean(this.data.pendingQueue[itemId]);
  }

  getPendingItem(itemId) {
    return this.data.pendingQueue[itemId] || null;
  }

  getPendingQueueWithCountdown() {
    const now = Date.now();
    const result = {};

    for (const [itemId, item] of Object.entries(this.data.pendingQueue)) {
      const scheduledMs = new Date(item.scheduledAt).getTime();
      const diffMs = scheduledMs - now;
      const minutesLeft = Math.max(0, Math.ceil(diffMs / 60000));
      const secondsLeft = Math.max(0, Math.ceil(diffMs / 1000));
      const isReady = diffMs <= 0;

      result[itemId] = {
        ...item,
        minutesLeft,
        secondsLeft,
        isReady
      };
    }

    return result;
  }
}

const rulesManager = new RulesManager();
module.exports = rulesManager;
