#!/usr/bin/env node

const ebayApi = require('./ebay_api');
const monitor = require('./monitor');
const config = require('./config');
const rulesManager = require('./rules_manager');

const args = process.argv.slice(2);
const command = args[0] || 'help';

function printHeader() {
  console.log('\n======================================================');
  console.log('📦 EBAY INVENTORY AUTOMATION - TERMINAL CLI');
  console.log(`🌐 Ambiente: ${config.envName} | Sito ID: ${config.siteId}`);
  console.log('======================================================\n');
}

function showHelp() {
  printHeader();
  console.log('Comandi disponibili:');
  console.log('  node cli.js test                     - Verifica connessione e credenziali eBay');
  console.log('  node cli.js list                     - Mostra tutte le inserzioni attive e relative quantità');
  console.log('  node cli.js list --zero              - Mostra solo le inserzioni esaurite (Quantità 0)');
  console.log('  node cli.js set <ID_o_SKU> <QUANTITA>- Imposta manualmente la quantità per un\'inserzione');
  console.log('  node cli.js price <ID_o_SKU> <PREZZO>- Modifica il prezzo di vendita per un\'inserzione');
  console.log('  node cli.js rule <ID> <MINUTI> [QTY] - Configura timer ritardo per un\'inserzione (es. 10m)');
  console.log('  node cli.js pending                  - Mostra le inserzioni in attesa con timer attivo');
  console.log('  node cli.js restock                  - Esegue controllo Auto-Restock con rispetto dei timer');
  console.log('  node cli.js restock --force          - Forza il ripristino immediato a 1 saltando i timer');
  console.log('  node cli.js monitor [minuti]         - Avvia monitoraggio continuo in background (default 15m)');
  console.log('  node cli.js help                     - Mostra questa guida\n');
}

async function run() {
  try {
    switch (command.toLowerCase()) {
      case 'test': {
        printHeader();
        console.log('⏳ Test di connessione alle API eBay in corso...');
        const res = await ebayApi.testConnection();
        if (res.ok) {
          console.log('✅ Connessione RIUSCITA!');
          console.log(`⏰ Orario Ufficiale eBay: ${res.ebayTime}`);
          console.log(`🌍 Ambiente: ${res.environment}`);
        } else {
          console.log('❌ Connessione FALLITA:');
          console.log(`   ${res.error}`);
        }
        break;
      }

      case 'list': {
        printHeader();
        const zeroOnly = args.includes('--zero');
        console.log(`⏳ Caricamento inserzioni attive ${zeroOnly ? '(solo esaurite)' : ''}...`);
        
        const data = await ebayApi.getActiveListings(1, 100);
        const pendingQueue = rulesManager.getPendingQueueWithCountdown();
        let items = data.items;

        if (zeroOnly) {
          items = items.filter(i => i.quantityAvailable <= 0);
        }

        if (items.length === 0) {
          console.log(zeroOnly ? '🎉 Nessuna inserzione a quantità zero!' : 'Nessuna inserzione attiva trovata.');
          return;
        }

        console.log(`\n📋 Totale inserzioni visualizzate: ${items.length}\n`);
        console.log('---------------------------------------------------------------------------------------------------------');
        console.log(' ITEM ID        | SKU             | DISP. | VEND. | PREZZO    | TIMER / STATO        | TITOLO');
        console.log('---------------------------------------------------------------------------------------------------------');

        for (const item of items) {
          const id = item.itemId.padEnd(14, ' ');
          const sku = (item.sku || '-').slice(0, 15).padEnd(15, ' ');
          const disp = String(item.quantityAvailable).padStart(5, ' ');
          const vend = String(item.quantitySold).padStart(5, ' ');
          const price = `${item.price} ${item.currency}`.padStart(9, ' ');
          
          const rule = rulesManager.getItemRule(item.itemId);
          const pending = pendingQueue[item.itemId];

          let timerStatus = rule.delayMinutes > 0 ? `${rule.delayMinutes}m ritardo` : 'Immediato';
          if (pending) {
            timerStatus = `⏳ Tra ${pending.minutesLeft}m`;
          }
          timerStatus = timerStatus.padEnd(20, ' ');

          const title = item.title.slice(0, 25);
          const statusIcon = item.quantityAvailable <= 0 ? (pending ? '⏳' : '⚠️') : '✅';
          console.log(`${statusIcon} ${id} | ${sku} | ${disp} | ${vend} | ${price} | ${timerStatus} | ${title}`);
        }
        console.log('---------------------------------------------------------------------------------------------------------\n');
        break;
      }

      case 'rule': {
        printHeader();
        const itemId = args[1];
        const delayMinutes = parseInt(args[2], 10);
        const targetQty = parseInt(args[3] || '1', 10);

        if (!itemId || isNaN(delayMinutes) || delayMinutes < 0) {
          console.log('❌ Sintassi: node cli.js rule <ItemID> <MinutiRitardo> [QuantitaRipristino]');
          console.log('   Esempio: node cli.js rule 123456789012 10 1 (aspetta 10 min e ripristina a 1)');
          return;
        }

        const saved = rulesManager.setItemRule(itemId, {
          enabled: true,
          delayMinutes,
          targetQty
        });

        console.log(`✅ Regola salvata per inserzione ${itemId}:`);
        console.log(`   ⏱️  Ritardo: ${saved.delayMinutes} minuti dopo passaggio a zero`);
        console.log(`   🎯 Quantità di ripristino: ${saved.targetQty}`);
        break;
      }

      case 'pending': {
        printHeader();
        const pendingQueue = rulesManager.getPendingQueueWithCountdown();
        const keys = Object.keys(pendingQueue);

        if (keys.length === 0) {
          console.log('🎉 Nessuna inserzione attualmente in coda con timer attivo.');
          return;
        }

        console.log(`⏳ Inserzioni in attesa di ripristino (${keys.length}):\n`);
        for (const [id, item] of Object.entries(pendingQueue)) {
          const schedTime = new Date(item.scheduledAt).toLocaleTimeString();
          console.log(` • [${id}] "${item.title}"`);
          console.log(`   ⏱️  Mancano: ~${item.minutesLeft} min (Programmato per le: ${schedTime}) -> Quantità finale: ${item.targetQty}`);
        }
        console.log('');
        break;
      }

      case 'set': {
        printHeader();
        const targetIdOrSku = args[1];
        const targetQty = parseInt(args[2], 10);

        if (!targetIdOrSku || isNaN(targetQty) || targetQty < 0) {
          console.log('❌ Sintassi: node cli.js set <ItemID_o_SKU> <Quantità>');
          return;
        }

        console.log(`⏳ Aggiornamento inserzione ${targetIdOrSku} a quantità ${targetQty}...`);
        const isNumeric = /^\d{10,14}$/.test(targetIdOrSku);
        const itemId = isNumeric ? targetIdOrSku : null;
        const sku = !isNumeric ? targetIdOrSku : null;

        const result = await ebayApi.updateItemQuantity(itemId, targetQty, sku, 0);

        if (result.success) {
          if (itemId) rulesManager.removeFromPending(itemId);
          console.log(`✅ SUCCESSO! Quantità aggiornata a ${targetQty} per ${targetIdOrSku}`);
        } else {
          console.log(`❌ ERRORE: ${result.error}`);
        }
        break;
      }

      case 'price': {
        printHeader();
        const targetIdOrSku = args[1];
        const newPrice = parseFloat(args[2]);

        if (!targetIdOrSku || isNaN(newPrice) || newPrice <= 0) {
          console.log('❌ Sintassi: node cli.js price <ItemID_o_SKU> <NuovoPrezzo>');
          console.log('   Esempio:  node cli.js price 377416254872 5.49');
          return;
        }

        console.log(`⏳ Aggiornamento prezzo per ${targetIdOrSku} a ${newPrice.toFixed(2)} EUR...`);
        const isNumeric = /^\d{10,14}$/.test(targetIdOrSku);
        const itemId = isNumeric ? targetIdOrSku : null;
        const sku = !isNumeric ? targetIdOrSku : null;

        const result = await ebayApi.updateItemPrice(itemId, newPrice, 'EUR', sku);

        if (result.success) {
          console.log(`✅ SUCCESSO! Prezzo aggiornato a ${result.newPrice} ${result.currency} per ${targetIdOrSku}`);
        } else {
          console.log(`❌ ERRORE: ${result.error}`);
        }
        break;
      }

      case 'restock': {
        printHeader();
        const force = args.includes('--force');
        console.log(`⏳ Esecuzione Auto-Restock ${force ? '(FORZATO SUBITO)' : 'con rispetto dei timer'}...`);
        const summary = await monitor.runCheck(force);
        console.log('\n📊 RIEPILOGO:');
        console.log(`   Inserzioni attive totali: ${summary.totalActive}`);
        console.log(`   Inserzioni a zero:        ${summary.zeroCount}`);
        console.log(`   In coda timer:            ${summary.pendingQueueCount}`);
        console.log(`   Ripristinate ora:         ${summary.restockedCount}`);
        break;
      }

      case 'monitor': {
        printHeader();
        const minutes = parseInt(args[1] || '15', 10);
        console.log(`🔄 Avvio monitoraggio continuo (controllo ogni ${minutes} minuti)...`);
        console.log('   I timer delle singole inserzioni verranno gestiti automaticamente.');
        console.log('   Premi CTRL+C per interrompere.\n');
        monitor.start(minutes);
        break;
      }

      case 'help':
      default:
        showHelp();
        break;
    }
  } catch (error) {
    console.error(`\n❌ ERRORE: ${error.message}\n`);
  }
}

run();
