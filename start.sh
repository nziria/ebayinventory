#!/bin/bash

# Script di avvio e gestione persistenza per Termux su Android

clear
echo "=================================================="
echo "      📦 EBAY INVENTORY AUTOMATION (TERMUX)       "
echo "=================================================="
echo ""

# Verifica se node è installato
if ! command -v node &> /dev/null
then
    echo "⚠️ Node.js non trovato. Installazione in corso..."
    pkg update && pkg install nodejs -y
fi

# Verifica se node_modules esiste
if [ ! -d "node_modules" ]; then
    echo "📦 Installazione dipendenze in corso..."
    npm install
fi

# Verifica se il file .env esiste
if [ ! -f ".env" ]; then
    echo "⚠️ File .env non trovato. Creazione dal modello .env.example..."
    cp .env.example .env
fi

# Funzione per attivare il Wake-Lock (impedisce a Android di sospendere la CPU a schermo spento)
enable_wakelock() {
    if command -v termux-wake-lock &> /dev/null; then
        termux-wake-lock
        echo "🔋 Wake-Lock ATTIVATO: Android non sospenderà il processo a schermo spento."
    else
        echo "ℹ️  Per attivare il Wake-Lock, trascina giù la tendina delle notifiche di Android"
        echo "   sulla notifica di Termux e tocca 'Acquire wakelock'."
    fi
}

show_menu() {
    echo "Scegli un'opzione:"
    echo "  [1] 🚀 Avvia Web App in Primo Piano (http://localhost:3000)"
    echo "  [2] 🛡️  Avvia in Background 24/7 con PM2 (Persistente & Riavvio Automatico)"
    echo "  [3] 🛑 Ferma il servizio in Background (PM2)"
    echo "  [4] 📜 Mostra Log del servizio in Background"
    echo "  [5] ⚡ Esegui Auto-Restock Adesso (0 -> 1)"
    echo "  [6] 📋 Mostra Inserzioni Attive e Timer"
    echo "  [7] ⏳ Mostra Inserzioni in Coda Timer"
    echo "  [8] 🔍 Test Connessione eBay API"
    echo "  [9] ⚙️  Configura Avvio Automatico all'accensione del telefono (Termux:Boot)"
    echo "  [0] ❌ Esci"
    echo ""
    read -p "Inserisci numero (0-9): " choice
}

while true; do
    show_menu
    case $choice in
        1)
            echo ""
            enable_wakelock
            echo "🚀 Avvio Server Web..."
            echo "📱 Apri il tuo browser Android e vai su: http://localhost:3000"
            echo "ℹ️  Premi CTRL+C per fermare il server."
            echo ""
            node server.js
            ;;
        2)
            echo ""
            enable_wakelock
            if ! command -v pm2 &> /dev/null; then
                echo "📦 Installazione di PM2 (gestore di processi in background)..."
                npm install -g pm2
            fi
            echo "🚀 Avvio processo in background con PM2..."
            pm2 start server.js --name ebay-stock
            pm2 save
            echo ""
            echo "✅ Server avviato in background con successo!"
            echo "📱 Accedi su: http://localhost:3000"
            echo "ℹ️  Il server rimarrà attivo anche chiudendo la finestra di Termux."
            echo ""
            ;;
        3)
            echo ""
            if command -v pm2 &> /dev/null; then
                pm2 stop ebay-stock
                echo "🛑 Servizio fermato."
            else
                echo "PM2 non installato."
            fi
            echo ""
            ;;
        4)
            echo ""
            if command -v pm2 &> /dev/null; then
                pm2 logs ebay-stock --lines 30
            else
                echo "PM2 non installato."
            fi
            echo ""
            ;;
        5)
            echo ""
            node cli.js restock
            echo ""
            ;;
        6)
            echo ""
            node cli.js list
            echo ""
            ;;
        7)
            echo ""
            node cli.js pending
            echo ""
            ;;
        8)
            echo ""
            node cli.js test
            echo ""
            ;;
        9)
            echo ""
            echo "⚙️ Configurazione Termux:Boot (avvio automatico all'accensione)..."
            mkdir -p ~/.termux/boot/
            cat << 'EOF' > ~/.termux/boot/start-ebay.sh
#!/data/data/com.termux/files/usr/bin/sh
termux-wake-lock
if command -v pm2 &> /dev/null; then
    pm2 resurrect
else
    cd ~/ebayinventory && node server.js &
fi
EOF
            chmod +x ~/.termux/boot/start-ebay.sh
            echo "✅ Script di avvio creato in ~/.termux/boot/start-ebay.sh"
            echo "ℹ️  Ricorda di installare l'app 'Termux:Boot' da F-Droid per l'avvio all'accensione."
            echo ""
            ;;
        0)
            echo "Arrivederci!"
            exit 0
            ;;
        *)
            echo "Opzione non valida!"
            echo ""
            ;;
    esac
done
