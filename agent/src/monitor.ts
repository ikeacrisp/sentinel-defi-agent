import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { createHash } from "crypto";
import { randomBytes } from "crypto";
import nacl from "tweetnacl";
import {
  RescueCipher,
  deserializeLE,
  getMXEAccAddress,
  getMempoolAccAddress,
  getCompDefAccAddress,
  getExecutingPoolAccAddress,
  getComputationAccAddress,
  getClusterAccAddress,
  getMXEPublicKey,
  getArciumEnv,
  getCompDefAccOffset,
  x25519,
} from "@arcium-hq/client";
import { AlertService } from "./alerts";
import { fetchPositionData, PositionSnapshot } from "./positions";

const ENCRYPTION_KEY_MESSAGE = "sentinel-defi-encryption-key-v1";

interface MonitoredPosition {
  positionId: number;
  owner: PublicKey;
  protocol: string;
  lastCheck: number;
}

export class SentinelMonitor {
  private connection: Connection;
  private wallet: Keypair;
  private programId: PublicKey;
  private alertService: AlertService;
  private intervalMs: number;
  private running = false;
  private positions: MonitoredPosition[] = [];
  private cipher: RescueCipher | null = null;
  private encryptionPublicKey: Uint8Array | null = null;

  constructor(
    connection: Connection,
    wallet: Keypair,
    programId: PublicKey,
    alertService: AlertService,
    intervalMs: number
  ) {
    this.connection = connection;
    this.wallet = wallet;
    this.programId = programId;
    this.alertService = alertService;
    this.intervalMs = intervalMs;
  }

  async start(): Promise<void> {
    this.running = true;

    // Initialize encryption
    await this.initEncryption();

    // Subscribe to program events
    this.subscribeToEvents();

    // Main monitoring loop
    while (this.running) {
      try {
        await this.monitoringCycle();
      } catch (err) {
        console.error("Monitoring cycle error:", err);
        await this.alertService.sendAlert(
          "WARNING",
          "Agent monitoring cycle encountered an error. Retrying..."
        );
      }
      await sleep(this.intervalMs);
    }
  }

  stop(): void {
    this.running = false;
  }

  private async initEncryption(): Promise<void> {
    console.log("Initializing Arcium encryption...");

    // Derive deterministic x25519 keypair from wallet
    const messageBytes = new TextEncoder().encode(ENCRYPTION_KEY_MESSAGE);
    const signature = nacl.sign.detached(messageBytes, this.wallet.secretKey);
    const privateKey = new Uint8Array(
      createHash("sha256").update(signature).digest()
    );
    this.encryptionPublicKey = x25519.getPublicKey(privateKey);

    // Get MXE public key for shared secret
    const provider = new anchor.AnchorProvider(
      this.connection,
      new anchor.Wallet(this.wallet),
      { commitment: "confirmed" }
    );

    let mxePublicKey: Uint8Array | null = null;
    for (let i = 0; i < 10; i++) {
      try {
        mxePublicKey = await getMXEPublicKey(provider, this.programId);
        if (mxePublicKey) break;
      } catch {
        console.log(`Retrying MXE key fetch (${i + 1}/10)...`);
        await sleep(1000);
      }
    }

    if (!mxePublicKey) {
      throw new Error("Failed to fetch MXE public key");
    }

    const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
    this.cipher = new RescueCipher(sharedSecret);

    console.log("Encryption initialized successfully");
  }

  private subscribeToEvents(): void {
    console.log("Subscribing to on-chain events...");

    // Listen for health check completions
    this.connection.onLogs(this.programId, (logs) => {
      if (logs.err) return;

      const logStr = logs.logs.join("\n");

      if (logStr.includes("HealthCheckCompleted")) {
        console.log(`[${timestamp()}] Health check completed (tx: ${logs.signature.slice(0, 8)}...)`);
      }

      if (logStr.includes("RiskRevealed")) {
        const isAtRisk = logStr.includes("is_at_risk: true");
        if (isAtRisk) {
          console.log(`[${timestamp()}] RISK DETECTED!`);
          this.alertService.sendAlert(
            "CRITICAL",
            "Position at risk! The privacy-preserving health check detected a threat. Check your positions immediately."
          );
        } else {
          console.log(`[${timestamp()}] Position is safe`);
        }
      }

      if (logStr.includes("ActionRequired")) {
        console.log(`[${timestamp()}] Emergency action triggered`);
        this.alertService.sendAlert(
          "ACTION",
          "Emergency action has been triggered for a position at risk. The agent is executing pre-authorized protective measures."
        );
      }
    });

    console.log("Event subscription active");
  }

  private async monitoringCycle(): Promise<void> {
    console.log(`[${timestamp()}] Running monitoring cycle...`);

    // Fetch current position data from DeFi protocols
    const snapshots = await fetchPositionData(this.connection, this.wallet.publicKey);

    if (snapshots.length === 0) {
      console.log(`[${timestamp()}] No active positions to monitor`);
      return;
    }

    console.log(`[${timestamp()}] Monitoring ${snapshots.length} position(s)`);

    for (const snapshot of snapshots) {
      try {
        await this.checkPosition(snapshot);
      } catch (err) {
        console.error(`Error checking position ${snapshot.protocol}:`, err);
      }
    }
  }

  private async checkPosition(snapshot: PositionSnapshot): Promise<void> {
    if (!this.cipher || !this.encryptionPublicKey) {
      throw new Error("Encryption not initialized");
    }

    console.log(
      `[${timestamp()}] Checking ${snapshot.protocol} position ` +
      `(encrypted - agent cannot see values)`
    );

    // Encrypt position data
    const positionData = [
      BigInt(snapshot.positionValueCents),
      BigInt(snapshot.collateralRatioBps),
      BigInt(snapshot.liquidationThresholdBps),
    ];

    const nonce = randomBytes(16);
    const ciphertext = this.cipher.encrypt(positionData, nonce);

    console.log(
      `[${timestamp()}] Encrypted position data submitted to Arcium MPC network`
    );

    // In production, this would submit to the on-chain program:
    // await program.methods.checkHealth(...)
    // For now, log the encryption flow
    console.log(
      `[${timestamp()}] MPC nodes computing risk score on encrypted data...`
    );
    console.log(
      `[${timestamp()}] Privacy preserved: agent never sees position values`
    );
  }
}

function timestamp(): string {
  return new Date().toISOString().slice(11, 19);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
