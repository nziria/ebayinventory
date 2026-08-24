require('dotenv').config();

const isSandbox = (process.env.EBAY_ENV || 'PRODUCTION').toUpperCase() === 'SANDBOX';

const config = {
  clientId: process.env.EBAY_CLIENT_ID || '',
  clientSecret: process.env.EBAY_CLIENT_SECRET || '',
  refreshToken: process.env.EBAY_REFRESH_TOKEN || '',
  isSandbox,
  envName: isSandbox ? 'SANDBOX' : 'PRODUCTION',
  siteId: process.env.EBAY_SITE_ID || '101', // 101 = eBay Italia
  port: process.env.PORT || 3000,
  autoRestockInterval: parseInt(process.env.AUTO_RESTOCK_INTERVAL_MINUTES || '15', 10),
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123',
  
  // Endpoints API eBay
  oauthUrl: isSandbox
    ? 'https://api.sandbox.ebay.com/identity/v1/oauth2/token'
    : 'https://api.ebay.com/identity/v1/oauth2/token',
    
  tradingApiUrl: isSandbox
    ? 'https://api.sandbox.ebay.com/ws/api.dll'
    : 'https://api.ebay.com/ws/api.dll',
    
  compatibilityLevel: '1349',

  // Verifica se le credenziali minime sono configurate
  isConfigured: function() {
    return Boolean(
      this.clientId && 
      this.clientSecret && 
      this.refreshToken && 
      !this.clientId.includes('Inserisci_') && 
      !this.clientSecret.includes('Inserisci_') && 
      !this.refreshToken.includes('Inserisci_')
    );
  }
};

module.exports = config;
