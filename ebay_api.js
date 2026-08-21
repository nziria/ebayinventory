const axios = require('axios');
const xml2js = require('xml2js');
const config = require('./config');

// Cache del token OAuth in memoria
let cachedAccessToken = null;
let tokenExpiresAt = 0;

/**
 * Funzione di utilità per l'escape di caratteri XML
 */
function escapeXml(unsafe) {
  if (!unsafe) return '';
  return String(unsafe).replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
    }
  });
}

/**
 * Ottiene un Access Token valido utilizzando il Refresh Token OAuth 2.0
 */
async function getAccessToken() {
  if (!config.isConfigured()) {
    throw new Error('Credenziali eBay non configurate. Modifica il file .env con i tuoi dati.');
  }

  // Se il token in cache è ancora valido per almeno 2 minuti, usalo
  const now = Date.now();
  if (cachedAccessToken && now < tokenExpiresAt - 120000) {
    return cachedAccessToken;
  }

  const authHeader = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
  
  const params = new URLSearchParams();
  params.append('grant_type', 'refresh_token');
  params.append('refresh_token', config.refreshToken);

  try {
    const response = await axios.post(config.oauthUrl, params.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${authHeader}`
      },
      timeout: 15000
    });

    if (response.data && response.data.access_token) {
      cachedAccessToken = response.data.access_token;
      // expires_in è in secondi (tipicamente 7200)
      const expiresInSec = response.data.expires_in || 7200;
      tokenExpiresAt = Date.now() + (expiresInSec * 1000);
      return cachedAccessToken;
    } else {
      throw new Error('Risposta token non valida da eBay');
    }
  } catch (error) {
    const errorDetails = error.response ? JSON.stringify(error.response.data) : error.message;
    throw new Error(`Errore autenticazione OAuth eBay: ${errorDetails}`);
  }
}

/**
 * Esegue una chiamata alla Trading API di eBay inviando un payload XML
 */
async function callTradingApi(callName, requestXml) {
  const token = await getAccessToken();

  const headers = {
    'X-EBAY-API-SITEID': config.siteId,
    'X-EBAY-API-COMPATIBILITY-LEVEL': config.compatibilityLevel,
    'X-EBAY-API-CALL-NAME': callName,
    'X-EBAY-API-IAF-TOKEN': token,
    'X-EBAY-API-APP-NAME': config.clientId,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Content-Type': 'text/xml; charset=utf-8'
  };

  try {
    const response = await axios.post(config.tradingApiUrl, requestXml, {
      headers,
      timeout: 25000
    });

    const parsed = await xml2js.parseStringPromise(response.data, {
      explicitArray: false,
      ignoreAttrs: false,
      mergeAttrs: true
    });

    return parsed;
  } catch (error) {
    if (error.response && error.response.data) {
      try {
        const parsedErr = await xml2js.parseStringPromise(error.response.data, { explicitArray: false });
        throw new Error(`Errore API eBay (${callName}): ${JSON.stringify(parsedErr)}`);
      } catch (e) {
        throw new Error(`Errore API eBay (${callName}): ${error.response.data}`);
      }
    }
    throw new Error(`Errore di connessione API eBay (${callName}): ${error.message}`);
  }
}

/**
 * Costruisce il tag XML <VariationSpecifics> a partire da un oggetto o array
 */
function buildVariationSpecificsXml(specs) {
  if (!specs) return '';
  if (typeof specs === 'string') {
    if (specs.startsWith('<VariationSpecifics>')) return specs;
    try {
      specs = JSON.parse(specs);
    } catch(e) {
      return '';
    }
  }

  let list = [];
  if (specs.NameValueList) {
    list = Array.isArray(specs.NameValueList) ? specs.NameValueList : [specs.NameValueList];
  } else if (Array.isArray(specs)) {
    list = specs;
  } else if (typeof specs === 'object') {
    list = Object.entries(specs).map(([Name, Value]) => ({ Name, Value }));
  }

  if (!list.length) return '';

  let xml = '<VariationSpecifics>';
  for (const item of list) {
    const name = item.Name || item.name;
    const value = item.Value || item.value;
    if (name && value) {
      xml += `<NameValueList><Name>${escapeXml(name)}</Name><Value>${escapeXml(value)}</Value></NameValueList>`;
    }
  }
  xml += '</VariationSpecifics>';
  return xml;
}

/**
 * Recupera le inserzioni attive del venditore tramite GetMyeBaySelling
 */
async function getActiveListings(pageNumber = 1, entriesPerPage = 100) {
  const requestXml = `<?xml version="1.0" encoding="utf-8"?>
<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ActiveList>
    <Sort>TimeLeft</Sort>
    <Pagination>
      <EntriesPerPage>${entriesPerPage}</EntriesPerPage>
      <PageNumber>${pageNumber}</PageNumber>
    </Pagination>
  </ActiveList>
  <DetailLevel>ReturnAll</DetailLevel>
  <OutputSelector>ActiveList</OutputSelector>
</GetMyeBaySellingRequest>`;

  const result = await callTradingApi('GetMyeBaySelling', requestXml);
  const responseObj = result.GetMyeBaySellingResponse || result;

  const ack = responseObj.Ack;
  if (ack !== 'Success' && ack !== 'Warning') {
    const errors = responseObj.Errors;
    const msg = errors ? (errors.LongMessage || errors.ShortMessage || JSON.stringify(errors)) : 'Errore sconosciuto';
    throw new Error(`GetMyeBaySelling fallita: ${msg}`);
  }

  const activeList = responseObj.ActiveList || {};
  const paginationResult = activeList.PaginationResult || {};
  const totalEntries = parseInt(paginationResult.TotalNumberOfEntries || '0', 10);
  const totalPages = parseInt(paginationResult.TotalNumberOfPages || '1', 10);

  let rawItems = activeList.ItemArray ? activeList.ItemArray.Item : [];
  if (!rawItems) {
    rawItems = [];
  } else if (!Array.isArray(rawItems)) {
    rawItems = [rawItems];
  }

  const items = rawItems.map(item => {
    const totalQty = parseInt(item.Quantity || '0', 10);
    const soldQty = parseInt(item.SellingStatus?.QuantitySold || '0', 10);
    
    // Calcolo quantità disponibile
    let availableQty = 0;
    if (item.QuantityAvailable !== undefined && item.QuantityAvailable !== null) {
      availableQty = parseInt(item.QuantityAvailable, 10);
    } else {
      availableQty = Math.max(0, totalQty - soldQty);
    }

    let price = '0.00';
    let currency = 'EUR';
    if (item.SellingStatus && item.SellingStatus.CurrentPrice) {
      const priceObj = item.SellingStatus.CurrentPrice;
      price = typeof priceObj === 'object' ? (priceObj._ || priceObj.value || '0.00') : priceObj;
      currency = (typeof priceObj === 'object' && priceObj.currencyID) ? priceObj.currencyID : 'EUR';
    }

    const itemId = item.ItemID;
    const sku = item.SKU || '';
    const title = item.Title || 'Senza Titolo';
    const imageUrl = item.PictureDetails?.GalleryURL || '';
    const viewUrl = item.ListingDetails?.ViewItemURL || `https://www.ebay.it/itm/${itemId}`;

    // Parsing varianti (se presenti)
    let variations = [];
    let hasVariations = false;

    if (item.Variations && item.Variations.Variation) {
      hasVariations = true;
      let rawVars = item.Variations.Variation;
      if (!Array.isArray(rawVars)) rawVars = [rawVars];

      variations = rawVars.map((v, index) => {
        const vTotal = parseInt(v.Quantity || '0', 10);
        const vSold = parseInt(v.SellingStatus?.QuantitySold || '0', 10);
        const vAvailable = Math.max(0, vTotal - vSold);

        let vPrice = price;
        let vCurrency = currency;
        if (v.StartPrice) {
          vPrice = typeof v.StartPrice === 'object' ? (v.StartPrice._ || v.StartPrice.value || '0.00') : v.StartPrice;
          if (typeof v.StartPrice === 'object' && v.StartPrice.currencyID) {
            vCurrency = v.StartPrice.currencyID;
          }
        }

        let varName = '';
        if (v.VariationSpecifics && v.VariationSpecifics.NameValueList) {
          const nvList = Array.isArray(v.VariationSpecifics.NameValueList)
            ? v.VariationSpecifics.NameValueList
            : [v.VariationSpecifics.NameValueList];
          varName = nvList.map(nv => `${nv.Name}: ${nv.Value}`).join(', ');
        }
        if (!varName && v.VariationTitle) {
          varName = v.VariationTitle;
        }
        if (!varName) {
          varName = `Variante #${index + 1}`;
        }

        return {
          id: `var-${itemId}-${index}`,
          name: varName,
          sku: v.SKU || '',
          price: parseFloat(vPrice).toFixed(2),
          currency: vCurrency,
          quantityTotal: vTotal,
          quantitySold: vSold,
          quantityAvailable: vAvailable,
          isZero: vAvailable <= 0,
          variationSpecifics: v.VariationSpecifics
        };
      });

      // Se ha varianti, la quantità totale disponibile è la somma delle varianti
      availableQty = variations.reduce((sum, v) => sum + v.quantityAvailable, 0);
    }

    return {
      itemId,
      sku,
      title,
      price: parseFloat(price).toFixed(2),
      currency,
      quantityTotal: totalQty,
      quantitySold: soldQty,
      quantityAvailable: availableQty,
      isZero: hasVariations ? variations.some(v => v.isZero) : availableQty <= 0,
      hasVariations,
      variations,
      imageUrl,
      viewUrl
    };
  });

  return {
    items,
    pagination: {
      pageNumber,
      entriesPerPage,
      totalEntries,
      totalPages
    }
  };
}

/**
 * Recupera TUTTE le inserzioni attive scorrendo tutte le pagine
 */
async function getAllActiveListings() {
  const firstPage = await getActiveListings(1, 100);
  let allItems = [...firstPage.items];
  const totalPages = firstPage.pagination.totalPages;

  if (totalPages > 1) {
    for (let page = 2; page <= totalPages; page++) {
      try {
        const nextPage = await getActiveListings(page, 100);
        allItems = allItems.concat(nextPage.items);
      } catch (err) {
        console.error(`Errore nel caricamento pagina ${page}: ${err.message}`);
      }
    }
  }

  return allItems;
}

/**
 * Aggiorna la quantità di un'inserzione o variante eBay
 * @param {string} itemId - ID dell'inserzione eBay
 * @param {number} newAvailableQuantity - La nuova quantità disponibile desiderata (es. 1)
 * @param {string} [sku] - SKU opzionale
 * @param {number} [quantitySold] - Quantità già venduta per calcolare il totale richiesto da eBay
 * @param {object|string} [variationSpecifics] - Specifiche della variante (se inserzione con varianti)
 */
async function updateItemQuantity(itemId, newAvailableQuantity, sku = null, quantitySold = 0, variationSpecifics = null) {
  if (!itemId && !sku) {
    throw new Error('È necessario specificare almeno ItemID o SKU');
  }

  const targetAvailable = parseInt(newAvailableQuantity, 10);
  if (isNaN(targetAvailable) || targetAvailable < 0) {
    throw new Error('La quantità deve essere un numero intero maggiore o uguale a 0');
  }

  const specsTag = buildVariationSpecificsXml(variationSpecifics);

  // Se è specificata una variante (VariationSpecifics), usiamo ReviseFixedPriceItem
  if (specsTag && itemId) {
    const skuTag = sku ? `<SKU>${escapeXml(sku)}</SKU>` : '';
    const requestXml = `<?xml version="1.0" encoding="utf-8"?>
<ReviseFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <Item>
    <ItemID>${itemId}</ItemID>
    <Variations>
      <Variation>
        ${skuTag}
        ${specsTag}
        <Quantity>${targetAvailable}</Quantity>
      </Variation>
    </Variations>
  </Item>
</ReviseFixedPriceItemRequest>`;

    const result = await callTradingApi('ReviseFixedPriceItem', requestXml);
    const responseObj = result.ReviseFixedPriceItemResponse || result;

    const ack = responseObj.Ack;
    const isSuccess = ack === 'Success' || ack === 'Warning';

    if (!isSuccess) {
      let errMsg = 'Errore durante l\'aggiornamento su eBay';
      if (responseObj.Errors) {
        const err = responseObj.Errors;
        errMsg = err.LongMessage || err.ShortMessage || JSON.stringify(err);
      }
      return {
        success: false,
        itemId,
        sku,
        ack,
        error: errMsg
      };
    }

    return {
      success: true,
      itemId,
      sku,
      ack,
      newAvailableQuantity: targetAvailable,
      timestamp: new Date().toISOString()
    };
  }

  // Altrimenti per inserzioni a prodotto singolo standard tramite ReviseInventoryStatus
  const skuTag = sku ? `<SKU>${escapeXml(sku)}</SKU>` : '';
  const itemIdTag = itemId ? `<ItemID>${itemId}</ItemID>` : '';

  const requestXml = `<?xml version="1.0" encoding="utf-8"?>
<ReviseInventoryStatusRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <InventoryStatus>
    ${itemIdTag}
    ${skuTag}
    <Quantity>${targetAvailable}</Quantity>
  </InventoryStatus>
</ReviseInventoryStatusRequest>`;

  const result = await callTradingApi('ReviseInventoryStatus', requestXml);
  const responseObj = result.ReviseInventoryStatusResponse || result;

  const ack = responseObj.Ack;
  const isSuccess = ack === 'Success' || ack === 'Warning';

  if (!isSuccess) {
    let errMsg = 'Errore durante l\'aggiornamento su eBay';
    if (responseObj.Errors) {
      const err = responseObj.Errors;
      errMsg = err.LongMessage || err.ShortMessage || JSON.stringify(err);
    }
    return {
      success: false,
      itemId,
      sku,
      ack,
      error: errMsg
    };
  }

  return {
    success: true,
    itemId,
    sku,
    ack,
    newAvailableQuantity: targetAvailable,
    timestamp: new Date().toISOString()
  };
}

/**
 * Aggiorna il prezzo di vendita di un'inserzione o variante eBay
 * @param {string} itemId - ID dell'inserzione eBay
 * @param {number|string} newPrice - Il nuovo prezzo di vendita (es. 9.99)
 * @param {string} [currency='EUR'] - Valuta (default EUR)
 * @param {string} [sku] - SKU opzionale
 * @param {object|string} [variationSpecifics] - Specifiche della variante (se inserzione con varianti)
 */
async function updateItemPrice(itemId, newPrice, currency = 'EUR', sku = null, variationSpecifics = null) {
  if (!itemId && !sku) {
    throw new Error('È necessario specificare almeno ItemID o SKU');
  }

  const priceNum = parseFloat(newPrice);
  if (isNaN(priceNum) || priceNum <= 0) {
    throw new Error('Il prezzo deve essere un numero positivo (es. 9.99)');
  }

  const formattedPrice = priceNum.toFixed(2);
  const specsTag = buildVariationSpecificsXml(variationSpecifics);

  // Se è specificata una variante (VariationSpecifics), usiamo ReviseFixedPriceItem
  if (specsTag && itemId) {
    const skuTag = sku ? `<SKU>${escapeXml(sku)}</SKU>` : '';
    const requestXml = `<?xml version="1.0" encoding="utf-8"?>
<ReviseFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <Item>
    <ItemID>${itemId}</ItemID>
    <Variations>
      <Variation>
        ${skuTag}
        ${specsTag}
        <StartPrice currencyID="${currency || 'EUR'}">${formattedPrice}</StartPrice>
      </Variation>
    </Variations>
  </Item>
</ReviseFixedPriceItemRequest>`;

    const result = await callTradingApi('ReviseFixedPriceItem', requestXml);
    const responseObj = result.ReviseFixedPriceItemResponse || result;

    const ack = responseObj.Ack;
    const isSuccess = ack === 'Success' || ack === 'Warning';

    if (!isSuccess) {
      let errMsg = 'Errore durante l\'aggiornamento del prezzo su eBay';
      if (responseObj.Errors) {
        const err = responseObj.Errors;
        errMsg = err.LongMessage || err.ShortMessage || JSON.stringify(err);
      }
      return {
        success: false,
        itemId,
        sku,
        ack,
        error: errMsg
      };
    }

    return {
      success: true,
      itemId,
      sku,
      ack,
      newPrice: formattedPrice,
      currency: currency || 'EUR',
      timestamp: new Date().toISOString()
    };
  }

  // Altrimenti per inserzioni a prodotto singolo standard tramite ReviseInventoryStatus
  const skuTag = sku ? `<SKU>${escapeXml(sku)}</SKU>` : '';
  const itemIdTag = itemId ? `<ItemID>${itemId}</ItemID>` : '';

  const requestXml = `<?xml version="1.0" encoding="utf-8"?>
<ReviseInventoryStatusRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <InventoryStatus>
    ${itemIdTag}
    ${skuTag}
    <StartPrice currencyID="${currency || 'EUR'}">${formattedPrice}</StartPrice>
  </InventoryStatus>
</ReviseInventoryStatusRequest>`;

  const result = await callTradingApi('ReviseInventoryStatus', requestXml);
  const responseObj = result.ReviseInventoryStatusResponse || result;

  const ack = responseObj.Ack;
  const isSuccess = ack === 'Success' || ack === 'Warning';

  if (!isSuccess) {
    let errMsg = 'Errore durante l\'aggiornamento del prezzo su eBay';
    if (responseObj.Errors) {
      const err = responseObj.Errors;
      errMsg = err.LongMessage || err.ShortMessage || JSON.stringify(err);
    }
    return {
      success: false,
      itemId,
      sku,
      ack,
      error: errMsg
    };
  }

  return {
    success: true,
    itemId,
    sku,
    ack,
    newPrice: formattedPrice,
    currency: currency || 'EUR',
    timestamp: new Date().toISOString()
  };
}

/**
 * Recupera gli ordini recenti completati e pagati tramite GetOrders
 * @param {number} [numberOfDays=2] - Giorni di storico da recuperare (max 30)
 */
async function getRecentOrders(numberOfDays = 2) {
  const requestXml = `<?xml version="1.0" encoding="utf-8"?>
<GetOrdersRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <NumberOfDays>${numberOfDays}</NumberOfDays>
  <OrderRole>Seller</OrderRole>
  <OrderStatus>Completed</OrderStatus>
  <DetailLevel>ReturnAll</DetailLevel>
</GetOrdersRequest>`;

  const result = await callTradingApi('GetOrders', requestXml);
  const responseObj = result.GetOrdersResponse || result;

  const ack = responseObj.Ack;
  if (ack !== 'Success' && ack !== 'Warning') {
    const errors = responseObj.Errors;
    const msg = errors ? (errors.LongMessage || errors.ShortMessage || JSON.stringify(errors)) : 'Errore sconosciuto';
    throw new Error(`GetOrders fallita: ${msg}`);
  }

  let rawOrders = responseObj.OrderArray ? responseObj.OrderArray.Order : [];
  if (!rawOrders) rawOrders = [];
  else if (!Array.isArray(rawOrders)) rawOrders = [rawOrders];

  const orders = [];

  for (const order of rawOrders) {
    const orderId = order.OrderID;
    const buyerUserId = order.BuyerUserID;
    const orderStatus = order.OrderStatus;
    const paidTime = order.PaidTime || order.CheckoutStatus?.LastModifiedTime;
    const isPaid = Boolean(order.PaidTime || order.AmountPaid?._ > 0 || order.CheckoutStatus?.Status === 'Complete');
    const isShipped = Boolean(order.ShippedTime);

    let rawTransactions = order.TransactionArray ? order.TransactionArray.Transaction : [];
    if (!rawTransactions) rawTransactions = [];
    else if (!Array.isArray(rawTransactions)) rawTransactions = [rawTransactions];

    const lineItems = rawTransactions.map(tx => {
      const txId = tx.TransactionID;
      const itemId = tx.Item?.ItemID;
      const title = tx.Item?.Title || 'Articolo';
      const qtyPurchased = parseInt(tx.QuantityPurchased || '1', 10);
      const sku = tx.Item?.SKU || tx.Variation?.SKU || '';

      // Varianti
      let varName = '';
      if (tx.Variation && tx.Variation.VariationSpecifics && tx.Variation.VariationSpecifics.NameValueList) {
        const nvList = Array.isArray(tx.Variation.VariationSpecifics.NameValueList)
          ? tx.Variation.VariationSpecifics.NameValueList
          : [tx.Variation.VariationSpecifics.NameValueList];
        varName = nvList.map(nv => `${nv.Name}: ${nv.Value}`).join(', ');
      } else if (tx.Variation && tx.Variation.VariationTitle) {
        varName = tx.Variation.VariationTitle;
      }

      return {
        transactionId: txId,
        itemId,
        title,
        sku,
        varName,
        quantityPurchased: qtyPurchased,
        transactionPrice: tx.TransactionPrice?._ || tx.TransactionPrice || '0.00',
        currency: tx.TransactionPrice?.currencyID || 'EUR'
      };
    });

    orders.push({
      orderId,
      buyerUserId,
      orderStatus,
      paidTime,
      isPaid,
      isShipped,
      createdTime: order.CreatedTime,
      totalAmount: order.Total?._ || order.Total || '0.00',
      currency: order.Total?.currencyID || 'EUR',
      lineItems
    });
  }

  return orders;
}

/**
 * Invia un messaggio eBay all'acquirente via AddMemberMessageAAQToPartner
 * @param {string} itemId - ID dell'inserzione
 * @param {string} recipientId - Buyer User ID di eBay
 * @param {string} subject - Oggetto del messaggio
 * @param {string} body - Corpo del messaggio
 */
async function sendBuyerMessage(itemId, recipientId, subject, body) {
  if (!itemId || !recipientId || !body) {
    throw new Error('ItemID, RecipientID e Body sono obbligatori per inviare un messaggio');
  }

  const cleanSubject = (subject || 'Dettagli Ordine').slice(0, 100);

  const requestXml = `<?xml version="1.0" encoding="utf-8"?>
<AddMemberMessageAAQToPartnerRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ItemID>${itemId}</ItemID>
  <MemberMessage>
    <Subject>${escapeXml(cleanSubject)}</Subject>
    <Body>${escapeXml(body)}</Body>
    <RecipientID>${escapeXml(recipientId)}</RecipientID>
    <QuestionType>General</QuestionType>
  </MemberMessage>
</AddMemberMessageAAQToPartnerRequest>`;

  const result = await callTradingApi('AddMemberMessageAAQToPartner', requestXml);
  const responseObj = result.AddMemberMessageAAQToPartnerResponse || result;

  const ack = responseObj.Ack;
  const isSuccess = ack === 'Success' || ack === 'Warning';

  if (!isSuccess) {
    let errMsg = 'Errore invio messaggio all\'acquirente su eBay';
    if (responseObj.Errors) {
      const err = responseObj.Errors;
      errMsg = err.LongMessage || err.ShortMessage || JSON.stringify(err);
    }
    return {
      success: false,
      itemId,
      recipientId,
      ack,
      error: errMsg
    };
  }

  return {
    success: true,
    itemId,
    recipientId,
    ack,
    timestamp: new Date().toISOString()
  };
}

/**
 * Segna un ordine come Spedito su eBay tramite CompleteSale
 * @param {string} orderId - ID dell'ordine eBay
 * @param {string} [transactionId] - Transaction ID facoltativo
 * @param {string} [itemId] - ItemID facoltativo
 */
async function markOrderAsShipped(orderId, transactionId = null, itemId = null) {
  if (!orderId && (!transactionId || !itemId)) {
    throw new Error('Specificare OrderID o la coppia TransactionID + ItemID');
  }

  let orderIdentifierXml = '';
  if (orderId) {
    orderIdentifierXml = `<OrderID>${escapeXml(orderId)}</OrderID>`;
  } else {
    orderIdentifierXml = `<ItemID>${itemId}</ItemID><TransactionID>${transactionId}</TransactionID>`;
  }

  const requestXml = `<?xml version="1.0" encoding="utf-8"?>
<CompleteSaleRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  ${orderIdentifierXml}
  <Shipped>true</Shipped>
</CompleteSaleRequest>`;

  const result = await callTradingApi('CompleteSale', requestXml);
  const responseObj = result.CompleteSaleResponse || result;

  const ack = responseObj.Ack;
  const isSuccess = ack === 'Success' || ack === 'Warning';

  if (!isSuccess) {
    let errMsg = 'Errore nel contrassegnare l\'ordine come spedito su eBay';
    if (responseObj.Errors) {
      const err = responseObj.Errors;
      errMsg = err.LongMessage || err.ShortMessage || JSON.stringify(err);
    }
    return {
      success: false,
      orderId,
      ack,
      error: errMsg
    };
  }

  return {
    success: true,
    orderId,
    ack,
    timestamp: new Date().toISOString()
  };
}

/**
 * Esegue un test di connessione alle API eBay e verifica la validità del token
 */
async function testConnection() {
  try {
    const token = await getAccessToken();
    if (!token) throw new Error('Impossibile ottenere l\'Access Token da eBay');

    // Verifica chiamando GetMyeBaySelling (prima pagina, 1 elemento)
    const listings = await getActiveListings(1, 1);

    return {
      ok: true,
      ebayTime: new Date().toISOString(),
      environment: config.envName,
      siteId: config.siteId,
      totalListings: listings.totalEntries
    };
  } catch (err) {
    return {
      ok: false,
      error: err.message
    };
  }
}

module.exports = {
  getAccessToken,
  callTradingApi,
  getActiveListings,
  getAllActiveListings,
  updateItemQuantity,
  updateItemPrice,
  getRecentOrders,
  sendBuyerMessage,
  markOrderAsShipped,
  testConnection
};
