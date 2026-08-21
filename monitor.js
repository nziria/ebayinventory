const ebayApi = require('./ebay_api');
const config = require('./config');
const rulesManager = require('./rules_manager');
const keysManager = require('./keys_manager');

class AutoRestockMonitor {
  constructor() {
    this.isRunning = false;
    this.intervalMinutes = config.autoRestockInterval || 15;
    this.timerId = null;
    this.lastCheckTime = null;
    this.nextCheckTime = null;
    this.logs = [];
    this.maxLogs = 100;
  }

  addLog(type, message, details = null) {
    const entry = {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
      timestamp: new Date().toISOString(),
      type, // 'INFO', 'SUCCESS', 'WARNING', 'ERROR', 'RESTOCK', 'TIMER'
      message,
      details
    };
    this.logs.unshift(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.pop();
    }
    console.log(`[${new Date().toLocaleTimeString()}] [${type}] ${message}`);
    return entry;
  }

  /**
   * Scansiona gli ordini recenti pagati ed esegue la consegna automatica delle licenze
   */
  async checkAndDeliverOrders() {
    try {
      const orders = await ebayApi.getRecentOrders(2);
      if (!orders || !orders.length) return 0;

      let deliveredCount = 0;

      for (const order of orders) {
        if (!order.isPaid) continue;

        for (const lineItem of order.lineItems) {
          const orderKey = `${order.orderId}_${lineItem.transactionId || lineItem.itemId}`;
          if (keysManager.isOrderProcessed(orderKey)) {
            continue; // già evaso
          }

          const targetKey = keysManager.getTargetKey(lineItem.itemId, lineItem.varName);
          const isEnabled = keysManager.isDigitalDeliveryEnabled(targetKey) || keysManager.isDigitalDeliveryEnabled(String(lineItem.itemId));
          const effectiveKey = keysManager.isDigitalDeliveryEnabled(targetKey) ? targetKey : String(lineItem.itemId);

          if (!isEnabled) continue;

          const itemVault = keysManager.getOrCreateItemVault(effectiveKey, lineItem.title, lineItem.sku);
          const availableCount = keysManager.getAvailableKeysCount(effectiveKey);

          if (availableCount > 0) {
            const keyConsumed = keysManager.consumeKey(effectiveKey, {
              orderId: order.orderId,
              buyerId: order.buyerUserId
            });

            if (keyConsumed) {
              const fullTitle = lineItem.title + (lineItem.varName ? ` [${lineItem.varName}]` : '');
              const messageBody = keysManager.formatMessage(itemVault.template, {
                key: keyConsumed.code,
                productName: fullTitle,
                buyerName: order.buyerUserId,
                orderId: order.orderId
              });

              const msgResult = await ebayApi.sendBuyerMessage(
                lineItem.itemId,
                order.buyerUserId,
                `Your Digital License Key - ${lineItem.title.slice(0, 45)}`,
                messageBody
              );

              let shippedOk = false;
              if (itemVault.autoShip !== false) {
                try {
                  await ebayApi.markOrderAsShipped(order.orderId, lineItem.transactionId, lineItem.itemId);
                  shippedOk = true;
                } catch (shipErr) {
                  console.error(`Errore markOrderAsShipped per ordine ${order.orderId}:`, shipErr.message);
                }
              }

              keysManager.markOrderProcessed(orderKey, {
                orderId: order.orderId,
                transactionId: lineItem.transactionId,
                buyerId: order.buyerUserId,
                itemId: lineItem.itemId,
                title: fullTitle,
                varName: lineItem.varName,
                keyUsed: keyConsumed.code,
                messageSent: msgResult.success,
                markedShipped: shippedOk,
                deliveredAt: new Date().toISOString()
              });

              this.addLog('SUCCESS', `🔑 Licenza inviata con successo a ${order.buyerUserId} per "${fullTitle}" (Ordine #${order.orderId})`, {
                orderId: order.orderId,
                buyer: order.buyerUserId,
                key: keyConsumed.code
              });

              deliveredCount++;
            }
          } else {
            // Chiavi esaurite: metti su OFF lo switch Consegna Automatica per questo articolo
            keysManager.setSettings(effectiveKey, { enabled: false });
            this.addLog('WARNING', `⚠️ Ordine #${order.orderId} (${order.buyerUserId}): Nessuna chiave rimasta per "${lineItem.title}". Consegna Automatica disattivata (switch su OFF).`);
          }
        }
      }

      return deliveredCount;
    } catch (err) {
      console.error('Errore nel controllo ordini & consegna automatica:', err.message);
      return 0;
    }
  }

  /**
   * Scansiona le inserzioni attive e gestisce ripristino immediato o a tempo
   * @param {boolean} forceAll - Se true, forza il ripristino immediato ignorando il ritardo
   * @param {string} [specificItemId] - Se specificato, esegue l'operazione solo per questo articolo
   */
  async runCheck(forceAll = false, specificItemId = null) {
    this.lastCheckTime = new Date().toISOString();

    // 1. Controllo ordini e consegna automatica chiavi digitali
    try {
      await this.checkAndDeliverOrders();
    } catch (e) {
      console.error('Errore checkAndDeliverOrders:', e.message);
    }

    this.addLog('INFO', `Avvio controllo inserzioni ${forceAll ? '(FORZATO SUBITO)' : 'con regole a tempo'}...`);

    try {
      const items = await ebayApi.getAllActiveListings();
      const zeroItems = items.filter(item => item.quantityAvailable <= 0);

      // Pulisci dalla coda eventuali articoli che sono tornati disponibili (> 0)
      for (const item of items) {
        if (item.quantityAvailable > 0 && rulesManager.isPending(item.itemId)) {
          rulesManager.removeFromPending(item.itemId);
          this.addLog('INFO', `Rimosso dalla coda timer: "${item.title}" ora disponibile (${item.quantityAvailable})`);
        }
      }

      const restockResults = [];
      const now = Date.now();

      for (const item of zeroItems) {
        if (specificItemId && item.itemId !== specificItemId) {
          continue;
        }

        const rule = rulesManager.getItemRule(item.itemId);

        // Se disabilitato per questa inserzione, salta
        if (!rule.enabled) {
          this.addLog('INFO', `Auto-Restock disattivato per regola su "${item.title}" (ID: ${item.itemId}).`);
          continue;
        }

        const targetQty = rule.targetQty || 1;
        const delayMinutes = parseInt(rule.delayMinutes, 10) || 0;

        // Lista di entità da ripristinare (l'articolo intero o le sue specifiche varianti a zero)
        const targetsToRestock = (item.hasVariations && item.variations && item.variations.length > 0)
          ? item.variations.filter(v => v.quantityAvailable <= 0).map(v => ({
              title: `${item.title} [${v.name}]`,
              varName: v.name,
              sku: v.sku,
              sold: v.quantitySold,
              specs: v.variationSpecifics
            }))
          : [{
              title: item.title,
              varName: null,
              sku: item.sku,
              sold: item.quantitySold,
              specs: null
            }];

        // Se richiesto ripristino forzato O se il ritardo configurato è 0 (immediato)
        if (forceAll || delayMinutes <= 0) {
          for (const target of targetsToRestock) {
            // Se le chiavi nel Vault sono 0, metti su OFF lo switch Consegna Automatica ma prosegui con il restock
            const targetKey = keysManager.getTargetKey(item.itemId, target.varName);
            const isVaultEnabled = keysManager.isDigitalDeliveryEnabled(targetKey) || keysManager.isDigitalDeliveryEnabled(String(item.itemId));
            const effectiveKey = keysManager.isDigitalDeliveryEnabled(targetKey) ? targetKey : String(item.itemId);

            if (isVaultEnabled) {
              const keysAvailable = keysManager.getAvailableKeysCount(effectiveKey);
              if (keysAvailable <= 0) {
                keysManager.setSettings(effectiveKey, { enabled: false });
                this.addLog('INFO', `ℹ️ Chiavi esaurite per "${target.title}": Consegna Automatica messa su OFF.`);
              }
            }

            try {
              this.addLog('INFO', `Ripristino a ${targetQty} per "${target.title}" (ID: ${item.itemId})...`);
              const result = await ebayApi.updateItemQuantity(item.itemId, targetQty, target.sku, target.sold, target.specs);

              if (result.success) {
                rulesManager.removeFromPending(item.itemId);
                this.addLog('RESTOCK', `✅ RIPRISTINATO a ${targetQty}: "${target.title}" (ID: ${item.itemId})`, {
                  itemId: item.itemId,
                  sku: target.sku,
                  title: target.title,
                  newQty: targetQty
                });
                restockResults.push({ success: true, itemId: item.itemId, title: target.title, newQty: targetQty });
              } else {
                this.addLog('ERROR', `❌ Errore ripristino "${target.title}": ${result.error}`);
                restockResults.push({ success: false, itemId: item.itemId, title: target.title, error: result.error });
              }
            } catch (e) {
              this.addLog('ERROR', `Eccezione ripristino "${target.title}": ${e.message}`);
            }
          }
          continue;
        }

        // Gestione con TIMER A TEMPO (delayMinutes > 0)
        if (!rulesManager.isPending(item.itemId)) {
          // Non ancora in coda: avvia il timer
          const pendingItem = rulesManager.addToPending(item, delayMinutes, targetQty);
          const targetTime = new Date(pendingItem.scheduledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          this.addLog('TIMER', `⏳ Timer avviato: "${item.title}" a quantità 0. Ripristino programmato tra ${delayMinutes} min (alle ${targetTime}).`, {
            itemId: item.itemId,
            delayMinutes,
            scheduledAt: pendingItem.scheduledAt
          });
        } else {
          // Già in coda: controlla se il tempo è scaduto (con tolleranza di 30s)
          const pending = rulesManager.getPendingItem(item.itemId);
          const scheduledMs = new Date(pending.scheduledAt).getTime();
          const diffMs = scheduledMs - now;

          if (diffMs <= 30000) {
            // Tempo scaduto (o mancano meno di 30 secondi)! Esegui il ripristino
            this.addLog('TIMER', `⏰ Timer SCADUTO (${pending.delayMinutes}m) per "${item.title}". Esecuzione ripristino...`);
            for (const target of targetsToRestock) {
              // Se le chiavi nel Vault sono 0, metti su OFF lo switch Consegna Automatica ma prosegui con il restock
              const targetKey = keysManager.getTargetKey(item.itemId, target.varName);
              const isVaultEnabled = keysManager.isDigitalDeliveryEnabled(targetKey) || keysManager.isDigitalDeliveryEnabled(String(item.itemId));
              const effectiveKey = keysManager.isDigitalDeliveryEnabled(targetKey) ? targetKey : String(item.itemId);

              if (isVaultEnabled) {
                const keysAvailable = keysManager.getAvailableKeysCount(effectiveKey);
                if (keysAvailable <= 0) {
                  keysManager.setSettings(effectiveKey, { enabled: false });
                  this.addLog('INFO', `ℹ️ Chiavi esaurite per "${target.title}": Consegna Automatica messa su OFF.`);
                }
              }

              try {
                const result = await ebayApi.updateItemQuantity(item.itemId, targetQty, target.sku, target.sold, target.specs);
                if (result.success) {
                  rulesManager.removeFromPending(item.itemId);
                  this.addLog('RESTOCK', `✅ RIPRISTINATO dopo timer (${pending.delayMinutes}m): "${target.title}" a quantità ${targetQty}!`, {
                    itemId: item.itemId,
                    newQty: targetQty
                  });
                  restockResults.push({ success: true, itemId: item.itemId, title: target.title, newQty: targetQty });
                } else {
                  this.addLog('ERROR', `❌ Errore ripristino dopo timer "${target.title}": ${result.error}`);
                }
              } catch (e) {
                this.addLog('ERROR', `Eccezione ripristino dopo timer: ${e.message}`);
              }
            }
          } else {
            // Timer ancora in corso
            const minutesLeft = Math.ceil(diffMs / 60000);
            this.addLog('INFO', `⏳ In attesa timer per "${item.title}": mancano ~${minutesLeft} min.`);
          }
        }
      }

      return {
        totalActive: items.length,
        zeroCount: zeroItems.length,
        pendingQueueCount: Object.keys(rulesManager.getPendingQueueWithCountdown()).length,
        restockedCount: restockResults.filter(r => r.success).length,
        results: restockResults
      };
    } catch (err) {
      this.addLog('ERROR', `Errore scansione Auto-Restock: ${err.message}`);
      throw err;
    }
  }

  /**
   * Avvia il monitoraggio automatico periodico
   */
  start(intervalMinutes = null) {
    if (intervalMinutes && intervalMinutes > 0) {
      this.intervalMinutes = intervalMinutes;
    }

    if (this.isRunning) {
      this.stop();
    }

    this.isRunning = true;
    const intervalMs = this.intervalMinutes * 60 * 1000;
    this.nextCheckTime = new Date(Date.now() + intervalMs).toISOString();

    this.addLog('INFO', `Monitoraggio automatico ATTIVATO (controllo ogni ${this.intervalMinutes} minuti).`);

    // Primo controllo immediato
    this.runCheck(false).catch(err => {
      console.error('Errore nel primo controllo automatico:', err.message);
    });

    // Controllo periodico
    this.timerId = setInterval(async () => {
      this.nextCheckTime = new Date(Date.now() + intervalMs).toISOString();
      try {
        await this.runCheck(false);
      } catch (e) {
        console.error('Errore durante ciclo monitor:', e.message);
      }
    }, intervalMs);

    return this.getStatus();
  }

  stop() {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    this.isRunning = false;
    this.nextCheckTime = null;
    this.addLog('INFO', 'Monitoraggio automatico DISATTIVATO.');
    return this.getStatus();
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      intervalMinutes: this.intervalMinutes,
      lastCheckTime: this.lastCheckTime,
      nextCheckTime: this.nextCheckTime,
      pendingQueue: rulesManager.getPendingQueueWithCountdown(),
      recentLogs: this.logs.slice(0, 30)
    };
  }
}

const monitorInstance = new AutoRestockMonitor();
module.exports = monitorInstance;
