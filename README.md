# 📦 eBay Inventory Automation per Android (Termux)

Sistema completo e autonomo per la gestione e il monitoraggio delle giacenze eBay direttamente dal tuo smartphone Android tramite **Termux**, con supporto ad **Auto-Restock a tempo (ritardo configurabile per singola inserzione)**, **onboarding grafico** ed **esecuzione persistente 24/7 in background**.

---

## ✨ Funzionalità

1. **Auto-Restock a Tempo (0 &rarr; 1) - Ritardo Configurabile:**
   - Intercetta le inserzioni attive la cui quantità disponibile è scesa a `0`.
   - **Ritardo personalizzabile per singola inserzione:** puoi impostare che una determinata inserzione aspetti **10 minuti** (o 5m, 15m, 30m, 60m o subito a 0m) prima di tornare a 1.
   - **Conto alla rovescia in tempo reale:** visualizza il badge `⏳ Ripristino tra ~8 min (alle 17:15)` e puoi saltare l'attesa con il tasto *"Ripristina Ora"*.
   - **Persistenza:** le regole e le code attive vengono salvate nel file `restock_rules.json` per non perdere nulla se riavvii l'app.
2. **🔑 Key Vault & Consegna Automatica Licenze (Digital Delivery):**
   - **Vault Chiavi:** carica una lista di codici o licenze (una per riga) per qualsiasi articolo o variante.
   - **Invio Automatico:** quando un cliente acquista e paga, il sistema preleva un codice dal Vault e invia un messaggio eBay all'acquirente con il testo personalizzato e la chiave.
   - **Segna come Spedito:** contrassegna l'ordine come spedito su eBay (`CompleteSale`).
   - **🛡️ Blocco di Sicurezza (Stock Guard):** se le chiavi nel Vault scendono a `0`, **l'Auto-Restock si blocca automaticamente** e l'articolo rimane a 0 su eBay per evitare vendite scoperte.
3. **Onboarding & Setup Guidato da Browser:**
   - Inserisci e testi le chiavi eBay direttamente dall'interfaccia grafica su `http://localhost:3000`.
   - Il sistema scrive e aggiorna automaticamente il file `.env`.
4. **Modifica Quantità e Prezzi in Tempo Reale:**
   - Visualizza tutte le inserzioni attive con foto, titolo, SKU, Item ID, prezzo e giacenza.
   - **Modifica Quantità:** pulsanti rapidi touch (`-5`, `-1`, `+1`, `+5`) o digitazione diretta.
   - **Modifica Prezzo:** tocca il cartellino del prezzo (`💰 4.99 EUR ✏️`) su qualsiasi inserzione o variante per modificare il prezzo di vendita su eBay.
   - Filtri rapidi: *Tutte*, *⚠️ Solo a 0*, *⏳ In Timer*, *✅ Disponibili*.
5. **Esecuzione Persistente in Background (24/7):**
   - Grazie a **PM2** e **Wake-Lock**, il server rimane attivo anche a schermo spento o chiudendo la finestra di Termux.

---

## 📱 Guida all'Installazione su Android con Termux

### 1. Installa Termux
Scarica e installa **Termux** da [F-Droid](https://f-droid.org/packages/com.termux/) (consigliato).

### 2. Prepara l'ambiente su Termux
Apri Termux e incolla questo comando:
```bash
pkg update && pkg install nodejs git nano -y
```

### 3. Copia o scarica la cartella del progetto
```bash
# Dai i permessi di archiviazione a Termux se necessario:
termux-setup-storage

# Spostati nella cartella del progetto:
cd ~/ebayinventory
npm install
```

---

## 🔋 Come Rendere l'App Persistente in Background (24/7)

Per evitare che Android chiuda Termux quando lo schermo si spegne o quando usi altre app, segui questi **3 semplici passaggi**:

### Passaggio 1: Disattiva il Risparmio Energetico su Android
1. Vai nelle **Impostazioni di Android** &rarr; **App** &rarr; **Termux**.
2. Tocca **Batteria** (o Risparmio Energetico) e seleziona **"Nessuna restrizione"** (o *"Senza restrizioni"*).
3. Se hai uno smartphone Xiaomi/Redmi/POCO, Oppo o Huawei:
   - Attiva la spunta su **Avvio Automatico** (Autostart).
   - Apri la schermata delle app recenti e metti il **lucchetto 🔒 su Termux** per evitare che venga chiuso.

### Passaggio 2: Attiva il Wake-Lock in Termux
Il Wake-Lock impedisce alla CPU del telefono di andare in "deep sleep" a schermo spento.
- Puoi farlo semplicemente lanciando:
  ```bash
  termux-wake-lock
  ```
- Oppure dalla tendina delle notifiche di Android, espandi la notifica di Termux e tocca **"Acquire wakelock"**.

### Passaggio 3: Avvia con PM2 (Gestore Processi Background)
Esegui:
```bash
bash start.sh
```
E seleziona l'opzione **`[2] Avvia in Background 24/7 con PM2`**.

In alternativa da comando:
```bash
npm install -g pm2
pm2 start server.js --name ebay-stock
pm2 save
```
👉 **Vantaggi di PM2:**
- Se l'app dovesse avere un errore, PM2 la **riavvia all'istante automaticamente**.
- Puoi chiudere Termux o usare il telefono normalmente: il monitoraggio delle quantità continuerà a girare in background!

---

## ⚡ Avvio Automatico all'Accensione del Telefono (Opzionale)

Se vuoi che il server si avvii da solo quando accendi o riavvii il telefono:
1. Installa l'add-on gratuito **Termux:Boot** da [F-Droid](https://f-droid.org/packages/com.termux.boot/).
2. Apri l'app Termux:Boot una volta per abilitarla.
3. In Termux lancia:
   ```bash
   bash start.sh
   ```
   e seleziona l'opzione **`[9] Configura Avvio Automatico all'accensione`**.

---

## 🚀 Utilizzo Quotidiano

1. Apri **Chrome** sul telefono e vai su:
   ```
   http://localhost:3000
   ```
2. Tocca i tre puntini in alto a destra su Chrome e scegli **"Aggiungi a schermata Home"**.
3. Avrai l'app a portata di tocco come una vera e propria applicazione Android!
