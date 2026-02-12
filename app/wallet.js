// Fold DeFi Agent — Shared Wallet Connection Module
// Exposes window.FoldWallet for all pages
// Depends on: @solana/web3.js IIFE bundle (window.solanaWeb3)

(function () {
  const HELIUS_RPC = 'https://devnet.helius-rpc.com/?api-key=10604451-ce29-4041-875d-88322f54ce98';
  const SESSION_PROVIDER_KEY = 'fold_wallet_provider';
  const SESSION_PUBKEY_KEY = 'fold_wallet_pubkey';

  window.FoldWallet = {
    connection: null,
    provider: null,
    publicKey: null,
    providerName: null,
    _balanceCache: { value: null, timestamp: 0 },

    async init() {
      this.connection = new solanaWeb3.Connection(HELIUS_RPC, 'confirmed');

      const savedProvider = sessionStorage.getItem(SESSION_PROVIDER_KEY);
      if (!savedProvider) return;

      const adapter = this._getProvider(savedProvider);
      if (!adapter) return;

      try {
        // Silent reconnect — only works if user previously approved this origin
        const resp = await adapter.connect({ onlyIfTrusted: true });
        this.provider = adapter;
        this.providerName = savedProvider;
        this.publicKey = resp.publicKey;
        sessionStorage.setItem(SESSION_PUBKEY_KEY, this.publicKey.toBase58());
        window.dispatchEvent(new CustomEvent('wallet-connected', {
          detail: { publicKey: this.publicKey.toBase58() }
        }));
      } catch (e) {
        // Silent reconnect failed — user must manually connect
        sessionStorage.removeItem(SESSION_PROVIDER_KEY);
        sessionStorage.removeItem(SESSION_PUBKEY_KEY);
      }
    },

    async connect(providerName) {
      const adapter = this._getProvider(providerName);
      if (!adapter) {
        throw new Error(providerName + ' wallet not detected. Please install it.');
      }

      const resp = await adapter.connect();
      this.provider = adapter;
      this.providerName = providerName;
      this.publicKey = resp.publicKey;
      sessionStorage.setItem(SESSION_PROVIDER_KEY, providerName);
      sessionStorage.setItem(SESSION_PUBKEY_KEY, this.publicKey.toBase58());
      window.dispatchEvent(new CustomEvent('wallet-connected', {
        detail: { publicKey: this.publicKey.toBase58() }
      }));
    },

    async disconnect() {
      try {
        if (this.provider && this.provider.disconnect) {
          await this.provider.disconnect();
        }
      } catch (e) {
        // Ignore disconnect errors
      }
      this.provider = null;
      this.providerName = null;
      this.publicKey = null;
      this._balanceCache = { value: null, timestamp: 0 };
      sessionStorage.removeItem(SESSION_PROVIDER_KEY);
      sessionStorage.removeItem(SESSION_PUBKEY_KEY);
      window.dispatchEvent(new CustomEvent('wallet-disconnected'));
      window.location.href = 'connect.html';
    },

    async getBalance() {
      if (!this.publicKey || !this.connection) return null;
      const now = Date.now();
      if (this._balanceCache.value !== null && (now - this._balanceCache.timestamp) < 30000) {
        return this._balanceCache.value;
      }
      try {
        const lamports = await this.connection.getBalance(this.publicKey);
        const sol = lamports / 1e9;
        this._balanceCache = { value: sol, timestamp: now };
        return sol;
      } catch (e) {
        console.error('Failed to fetch balance:', e);
        return this._balanceCache.value;
      }
    },

    shortenAddress(pubkeyOrString) {
      const str = typeof pubkeyOrString === 'string'
        ? pubkeyOrString
        : pubkeyOrString?.toBase58?.() || '';
      if (str.length <= 10) return str;
      return str.slice(0, 4) + '...' + str.slice(-4);
    },

    isConnected() {
      return this.publicKey !== null;
    },

    _getProvider(name) {
      switch (name) {
        case 'phantom':
          return window.phantom?.solana || window.solana;
        case 'solflare':
          return window.solflare;
        case 'backpack':
          return window.backpack;
        default:
          return null;
      }
    },

    getProviderAvailability() {
      return {
        phantom: !!(window.phantom?.solana || window.solana?.isPhantom),
        solflare: !!window.solflare,
        backpack: !!window.backpack,
      };
    }
  };
})();
