# Sentinel - Privacy-Preserving DeFi Security Agent

> An autonomous agent that monitors DeFi positions 24/7 using Arcium's MPC network — your portfolio is protected by an agent that literally cannot see your money.

## The Problem

DeFi users lose billions annually to exploits, rug pulls, and liquidations. Current monitoring tools require exposing your entire portfolio — creating a privacy contradiction. You shouldn't have to sacrifice privacy for security.

## The Solution

Sentinel is an autonomous agent that:

1. **Monitors** your DeFi positions in real-time across Solana protocols
2. **Detects** threats using privacy-preserving computation via Arcium MPC
3. **Acts** automatically — withdrawing funds, revoking approvals, sending alerts
4. **Never sees your data** — positions are encrypted client-side, computed on by distributed MPC nodes

### How It Works

```
You connect wallet
    → Agent scans positions (encrypted locally)
    → Encrypted data sent to Arcium MXE
    → MPC nodes compute risk (no single node sees plaintext)
    → Result: { at_risk: true/false, severity: 1-3 }
    → Agent sends alert & executes emergency actions
    → Your portfolio details remain private throughout
```

## Architecture

```
┌──────────────┐     ┌─────────────────────┐     ┌──────────────┐
│  User Wallet │────→│  Arcium MXE (MPC)   │────→│ Agent Service│
│              │     │  • Encrypted compute │     │ • Alerts     │
│ x25519 ECDH │     │  • Multi-node MPC    │     │ • Actions    │
│ Client-side  │     │  • No plaintext ever │     │ • Monitoring │
│ encryption   │     │  • Signed callbacks  │     │ • Helius WH  │
└──────────────┘     └─────────────────────┘     └──────────────┘
                              │
                     ┌────────┴────────┐
                     │ Solana Program  │
                     │ (Anchor)        │
                     │ • Queue compute │
                     │ • Handle callback│
                     │ • Emit events   │
                     └─────────────────┘
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Privacy | Arcium MPC (Arcis circuits, x25519 encryption) |
| Blockchain | Solana (Anchor framework) |
| Agent | Node.js/TypeScript |
| Data | Pyth oracles, Helius webhooks |
| Alerts | Telegram bot |
| Protocols | Kamino, MarginFi, Jupiter |

## Project Structure

```
sentinel-agent/
├── programs/sentinel/      # Solana Anchor program
├── encrypted-ixs/          # Arcis MPC circuits
├── agent/                  # TypeScript monitoring agent
├── tests/                  # Integration tests
└── app/                    # Frontend dashboard
```

## Quick Start

### Prerequisites

- Rust, Solana CLI 2.3.0, Anchor 0.32.1
- Arcium CLI (`arcup install`)
- Docker (for local Arcium testing)
- Node.js 18+, Yarn

### Build & Test

```bash
# Install dependencies
yarn install
cd agent && npm install && cd ..

# Build MPC circuits + Anchor program
arcium build

# Run tests (local cluster with Arcium MPC nodes)
arcium test

# Deploy to devnet
anchor deploy --provider.cluster devnet
arcium deploy --cluster-offset 456 --keypair-path ~/.config/solana/id.json --recovery-set-size 5 --rpc-url devnet --skip-deploy
arcium finalize-mxe-keys ABDZr3DvUSnugBNrAj8vaAhKt3tHafA82MDja812QbJC --cluster-offset 456 --keypair-path ~/.config/solana/id.json --rpc-url devnet
```

## Devnet Deployment

| Component | Address / Link |
|-----------|---------------|
| Program ID | `ABDZr3DvUSnugBNrAj8vaAhKt3tHafA82MDja812QbJC` |
| Deploy TX | [Explorer](https://explorer.solana.com/tx/2Uj4F8sjCdyyGpC4kbRpPH6RgEmZaM6rkg4t5JtcqAd1V6mNtmUpq4bHtkqHPwYFbSfSr2wp8QesWH1ML9fSEEiE?cluster=devnet) |
| MXE Init TX | [Explorer](https://explorer.solana.com/tx/3R8ZzhTaHkttJLcNjynKGCXLEMavdgVgeL8nqGimu4zo6EiMozgWRKkDPohfsLogahFEx8QKEcgMNtZqEwWguB9U?cluster=devnet) |
| MXE Keys TX | [Explorer](https://explorer.solana.com/tx/xRNSM7Spnnz8Ecv23zxaNWzu9kp5wknRKfBZ8eZXqg994haYHjL2cNUeygp3SCE3mhU8KKfuxeQeyJ1F5W4hvXr?cluster=devnet) |
| Cluster | Devnet offset 456 (2 active nodes) |
| IDL Account | `8D937Hk1NwEEqRh2P1vCbyNToShTs4yT8e1h9BNc2FPa` |

### Local Test Output

```
  Sentinel DeFi Security Agent
    MXE x25519 pubkey: [252, 251, 33, 11, ...]
    Initializing computation definitions...
    All computation definitions initialized
    Registering position...
    Position registered
    Submitting encrypted health check (risky position)...
    Health check completed
    Revealing risk status...
    Position at risk: true
      ✓ monitors positions and detects risk (23151ms)

  1 passing (23s)
```

### Run the Agent

```bash
cd agent
cp .env.example .env
# Edit .env with your Helius API key and Telegram bot token
npm run dev
```

## Privacy Guarantees

| Data | Visibility |
|------|-----------|
| Wallet address | Only you (not sent to MPC) |
| Position sizes | Encrypted (never decrypted) |
| Protocol names | Encrypted (never decrypted) |
| Collateral ratios | Encrypted (computed on via MPC) |
| Risk result | Only: safe/at-risk + severity level |

## Solana Integration

Sentinel uses Arcium's MPC network to enable privacy-preserving DeFi security monitoring on Solana. Users encrypt their position data client-side using x25519 key exchange, then submit to Arcium MXEs where distributed nodes compute risk scores without any single party seeing plaintext. Results trigger on-chain callbacks to our Anchor program, which emits events for the agent to execute pre-authorized protective actions. Integrates Pyth oracles for real-time price data and Helius webhooks for event monitoring.

## Tags

DeFi, Privacy, Security

## License

MIT

---

Built for the [Colosseum Agent Hackathon](https://colosseum.com) (Feb 2-13, 2026)
