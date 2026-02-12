// Fold DeFi Agent — On-chain Data Reader
// Exposes window.FoldProgram for all pages
// Depends on: @solana/web3.js IIFE (window.solanaWeb3), wallet.js (window.FoldWallet)

(function () {
  const PROGRAM_ID = new solanaWeb3.PublicKey('ABDZr3DvUSnugBNrAj8vaAhKt3tHafA82MDja812QbJC');

  // PositionAccount: 8 (disc) + 1 (bump) + 64 (risk_state) + 4 (position_id) + 32 (owner) + 16 (nonce) + 8 (last_check) + 1 (is_active) = 134
  const POSITION_ACCOUNT_SIZE = 134;
  const POSITION_ACCOUNT_DISC = new Uint8Array([60, 125, 250, 193, 181, 109, 238, 86]);
  const OWNER_OFFSET = 77; // byte offset of owner pubkey in PositionAccount

  // Anchor event discriminators (from IDL)
  const EVENT_DISC = {
    positionRegistered:   new Uint8Array([128, 82, 15, 99, 22, 150, 238, 103]),
    healthCheckCompleted: new Uint8Array([128, 134, 4, 255, 78, 88, 26, 87]),
    riskRevealed:         new Uint8Array([213, 255, 86, 151, 199, 125, 212, 169]),
    actionRequired:       new Uint8Array([149, 55, 253, 113, 143, 63, 95, 88]),
  };

  function arraysEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  window.FoldProgram = {
    programId: PROGRAM_ID,

    derivePositionPDA(ownerPubkey, positionId) {
      const idBuf = new ArrayBuffer(4);
      new DataView(idBuf).setUint32(0, positionId, true);
      return solanaWeb3.PublicKey.findProgramAddressSync(
        [
          new TextEncoder().encode('position'),
          ownerPubkey.toBytes(),
          new Uint8Array(idBuf),
        ],
        PROGRAM_ID
      );
    },

    deserializePosition(data) {
      // data is Uint8Array or Buffer
      const d = new Uint8Array(data);
      const view = new DataView(d.buffer, d.byteOffset, d.byteLength);

      // Verify discriminator
      const disc = d.slice(0, 8);
      if (!arraysEqual(disc, POSITION_ACCOUNT_DISC)) {
        return null;
      }

      const bump = d[8];
      const riskState = [d.slice(9, 41), d.slice(41, 73)];
      const positionId = view.getUint32(73, true);
      const owner = new solanaWeb3.PublicKey(d.slice(77, 109));

      // nonce: u128 LE (read as two u64s)
      const nonceLo = view.getBigUint64(109, true);
      const nonceHi = view.getBigUint64(117, true);
      const nonce = nonceLo + (nonceHi << 64n);

      const lastCheck = Number(view.getBigInt64(125, true));
      const isActive = d[133] === 1;

      return { bump, riskState, positionId, owner, nonce, lastCheck, isActive };
    },

    async fetchPosition(positionPDA) {
      const conn = window.FoldWallet.connection;
      const info = await conn.getAccountInfo(positionPDA);
      if (!info) return null;
      const pos = this.deserializePosition(info.data);
      if (!pos) return null;
      pos.address = positionPDA;
      return pos;
    },

    async fetchPositionsByOwner(ownerPubkey) {
      const conn = window.FoldWallet.connection;
      try {
        const accounts = await conn.getProgramAccounts(PROGRAM_ID, {
          filters: [
            { dataSize: POSITION_ACCOUNT_SIZE },
            { memcmp: { offset: OWNER_OFFSET, bytes: ownerPubkey.toBase58() } },
          ],
        });
        return accounts
          .map(({ pubkey, account }) => {
            const pos = this.deserializePosition(account.data);
            if (!pos) return null;
            pos.address = pubkey;
            return pos;
          })
          .filter(Boolean);
      } catch (e) {
        console.error('fetchPositionsByOwner failed:', e);
        return [];
      }
    },

    subscribeToEvents(callback) {
      const conn = window.FoldWallet.connection;
      return conn.onLogs(PROGRAM_ID, (logs) => {
        if (logs.err) return;
        for (const log of logs.logs) {
          if (log.startsWith('Program data: ')) {
            const b64 = log.slice('Program data: '.length);
            const parsed = this._parseEvent(b64);
            if (parsed) {
              callback(parsed.name, parsed.data, logs.signature);
            }
          }
        }
      }, 'confirmed');
    },

    unsubscribeFromEvents(subId) {
      const conn = window.FoldWallet.connection;
      if (subId != null) {
        conn.removeOnLogsListener(subId);
      }
    },

    _parseEvent(b64) {
      let raw;
      try {
        raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      } catch (e) {
        return null;
      }
      if (raw.length < 8) return null;
      const disc = raw.slice(0, 8);

      for (const [name, expected] of Object.entries(EVENT_DISC)) {
        if (arraysEqual(disc, expected)) {
          return { name, data: this._decodeEventData(name, raw.slice(8)) };
        }
      }
      return null;
    },

    _decodeEventData(name, data) {
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      try {
        switch (name) {
          case 'positionRegistered':
          case 'healthCheckCompleted': {
            // pubkey (32) + u32 (4) + i64 (8)
            const owner = new solanaWeb3.PublicKey(data.slice(0, 32)).toBase58();
            const positionId = view.getUint32(32, true);
            const timestamp = Number(view.getBigInt64(36, true));
            return { owner, positionId, timestamp };
          }
          case 'riskRevealed': {
            // bool (1) + i64 (8)
            const isAtRisk = data[0] === 1;
            const timestamp = Number(view.getBigInt64(1, true));
            return { isAtRisk, timestamp };
          }
          case 'actionRequired': {
            // String: 4-byte len + utf8, then i64
            const strLen = view.getUint32(0, true);
            const actionType = new TextDecoder().decode(data.slice(4, 4 + strLen));
            const timestamp = Number(view.getBigInt64(4 + strLen, true));
            return { actionType, timestamp };
          }
          default:
            return {};
        }
      } catch (e) {
        console.error('Event decode error:', e);
        return {};
      }
    }
  };
})();
