# Colosseum Agent Hackathon Submission

## Project Name
Fold — Privacy-Preserving DeFi Security Agent

## Description (1-2 sentences)
An autonomous agent that monitors DeFi positions 24/7 using Arcium's MPC network on Solana — detecting threats and executing protective actions without ever seeing your portfolio data.

## Tags
DeFi, Privacy, Security

## Solana Integration (max 1000 chars)
Fold uses Arcium's MPC network to enable privacy-preserving DeFi security monitoring on Solana. Users encrypt their position data client-side using x25519 key exchange, then submit to Arcium MXEs where distributed nodes compute risk scores without any single party seeing plaintext. Results trigger on-chain callbacks to our Anchor program, which emits events for the agent to execute pre-authorized protective actions via Jupiter swaps. Integrates Pyth oracles for real-time price data and Helius webhooks for event monitoring. The Anchor program stores encrypted risk state as on-chain account data, enabling trustless verification of computation results.

## Problem Statement (max 1200 chars)
DeFi users lose billions annually to exploits, rug pulls, and liquidations. Most users can't monitor their positions 24/7 — they're asleep when a protocol gets drained or a price crash triggers cascading liquidations. Current monitoring solutions (DeBank, Zapper, custom bots) require full portfolio visibility, creating a fundamental privacy contradiction: to protect your money, you must expose it. Sophisticated users with large positions are especially vulnerable — monitoring tools that can see their full portfolio create honeypot targets. There's no way to get 24/7 security without sacrificing privacy. Until now.

## Technical Approach (max 1200 chars)
Three-layer architecture: (1) Arcis MPC Circuits — written in Arcium's Rust DSL, these define encrypted computations for position health checks. User position data (values, collateral ratios, liquidation thresholds) enters encrypted via x25519 ECDH and RescueCipher. Multiple MPC nodes compute risk scores cooperatively — no single node sees plaintext. (2) Solana Anchor Program — manages computation lifecycle: queues encrypted health checks to Arcium MXE, handles signed callbacks with verified computation outputs, stores encrypted risk state on-chain, and emits events. (3) Agent Service — TypeScript monitoring loop that fetches oracle data (Pyth), encrypts position snapshots, submits to the program, listens for callback events via Helius webhooks, and triggers alerts (Telegram) or emergency actions when risk is detected.

## Target Audience (max 1000 chars)
DeFi power users with $10K+ positions across Solana lending/borrowing protocols (Kamino, MarginFi, Drift). They actively manage leveraged positions but can't monitor 24/7. They value privacy — they don't want monitoring tools or bots to know their exact portfolio composition. Secondary audience: DAOs and institutional DeFi participants who need automated treasury protection without exposing position details to third-party monitoring services.

## Business Model (max 1000 chars)
Freemium subscription: Free tier monitors 1 position with 60s check intervals. Pro tier ($9.99/month in USDC via Solana Pay) unlocks unlimited positions, 10s intervals, automated emergency actions, and multi-protocol monitoring. Revenue also from: premium alert channels (Discord/Slack integration), institutional API access for DAO treasury monitoring, and potential protocol partnerships where lending platforms integrate Fold as a native feature for their users.

## Competitive Landscape (max 1000 chars)
Existing DeFi monitors (DeBank, Zapper, custom Telegram bots) all require full portfolio visibility — they see everything. Arcium-based competitors don't exist yet in DeFi security. The closest is generic portfolio tracking without privacy. Fold's differentiation: the agent that protects your money literally cannot see it. This is only possible because Arcium's MPC network enables computation on encrypted data — a capability that didn't exist on Solana until Arcium's recent Mainnet Alpha launch. First-mover advantage in privacy-preserving DeFi security.

## Future Vision (max 1000 chars)
Post-hackathon: (1) Production deployment on Arcium Mainnet with real protocol integrations (Kamino, MarginFi, Jupiter). (2) Multi-chain expansion via Arcium's cross-chain MPC capabilities. (3) Advanced threat detection — MEV sandwich detection, governance attack monitoring, smart contract vulnerability scanning — all privacy-preserving. (4) Fold SDK for protocols to integrate privacy-preserving monitoring natively. (5) Decentralized agent network where multiple Fold instances can cooperatively monitor the ecosystem without any single agent seeing individual user data.
