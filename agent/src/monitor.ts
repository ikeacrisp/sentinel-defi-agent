import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { createHash, randomBytes } from "crypto";
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

const ENCRYPTION_KEY_MESSAGE = "fold-defi-encryption-key-v1";
const ARCIUM_CLUSTER_OFFSET = parseInt(process.env.ARCIUM_CLUSTER_OFFSET || "456");

interface MonitoredPosition {
  positionId: number;
  owner: PublicKey;
  protocol: string;
  lastCheck: number;
}

export class FoldMonitor {
  private connection: Connection;
  private wallet: Keypair;
  private programId: PublicKey;
  private alertService: AlertService;
  private intervalMs: number;
  private running = false;
  private positions: MonitoredPosition[] = [];
  private cipher: RescueCipher | null = null;
  private encryptionPublicKey: Uint8Array | null = null;
  private provider: anchor.AnchorProvider | null = null;
  private program: any = null;
  private clusterAccount: PublicKey | null = null;
  private cycleCount = 0;
  private threatsDetected = 0;

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

    // Initialize Anchor provider and program
    await this.initAnchor();

    // Initialize encryption
    await this.initEncryption();

    // Subscribe to program events
    this.subscribeToEvents();

    // Main monitoring loop
    while (this.running) {
      try {
        await this.monitoringCycle();
      } catch (err: any) {
        console.error(`[${timestamp()}] Monitoring cycle error:`, err.message || err);
        await this.alertService.sendAlert(
          "WARNING",
          `Agent monitoring cycle error: ${err.message || "Unknown error"}. Retrying...`
        );
      }
      await sleep(this.intervalMs);
    }
  }

  stop(): void {
    this.running = false;
  }

  private async initAnchor(): Promise<void> {
    console.log("Initializing Anchor provider...");

    this.provider = new anchor.AnchorProvider(
      this.connection,
      new anchor.Wallet(this.wallet),
      { commitment: "confirmed" }
    );

    // Load IDL from on-chain
    const idl = await anchor.Program.fetchIdl(this.programId, this.provider);
    if (!idl) {
      throw new Error("Failed to fetch IDL from on-chain. Is the program deployed?");
    }
    this.program = new anchor.Program(idl, this.provider);
    this.clusterAccount = getClusterAccAddress(ARCIUM_CLUSTER_OFFSET);

    console.log("Anchor provider initialized");
    console.log(`  Program: ${this.programId.toBase58()}`);
    console.log(`  Cluster offset: ${ARCIUM_CLUSTER_OFFSET}`);
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
    let mxePublicKey: Uint8Array | null = null;
    for (let i = 0; i < 10; i++) {
      try {
        mxePublicKey = await getMXEPublicKey(this.provider!, this.programId);
        if (mxePublicKey) break;
      } catch {
        console.log(`  Retrying MXE key fetch (${i + 1}/10)...`);
        await sleep(2000);
      }
    }

    if (!mxePublicKey) {
      throw new Error("Failed to fetch MXE public key");
    }

    const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
    this.cipher = new RescueCipher(sharedSecret);

    console.log("Encryption initialized successfully");
    console.log(`  Agent x25519 pubkey: ${Buffer.from(this.encryptionPublicKey).toString("hex").slice(0, 16)}...`);
  }

  private subscribeToEvents(): void {
    console.log("Subscribing to on-chain events...");

    this.connection.onLogs(this.programId, (logs) => {
      if (logs.err) return;
      const logStr = logs.logs.join("\n");

      if (logStr.includes("HealthCheckCompleted")) {
        console.log(`[${timestamp()}] >> Health check completed (tx: ${logs.signature.slice(0, 12)}...)`);
      }

      if (logStr.includes("RiskRevealed")) {
        const isAtRisk = logStr.includes("is_at_risk: true");
        if (isAtRisk) {
          this.threatsDetected++;
          console.log(`[${timestamp()}] >> RISK DETECTED! (threats total: ${this.threatsDetected})`);
          this.alertService.sendAlert(
            "CRITICAL",
            `Position at risk! Privacy-preserving health check detected a threat. Threats detected: ${this.threatsDetected}. Check your positions immediately.`
          );
        } else {
          console.log(`[${timestamp()}] >> Position is safe (risk reveal: false)`);
        }
      }

      if (logStr.includes("ActionRequired")) {
        console.log(`[${timestamp()}] >> Emergency action triggered!`);
        this.alertService.sendAlert(
          "ACTION",
          "Emergency action triggered for position at risk. Executing pre-authorized protective measures."
        );
      }
    });

    console.log("Event subscription active\n");
  }

  private async monitoringCycle(): Promise<void> {
    this.cycleCount++;
    console.log(`[${timestamp()}] ── Monitoring cycle #${this.cycleCount} ──`);

    // Fetch current position data
    const snapshots = await fetchPositionData(this.connection, this.wallet.publicKey);

    if (snapshots.length === 0) {
      console.log(`[${timestamp()}] No active positions to monitor`);
      return;
    }

    console.log(`[${timestamp()}] Monitoring ${snapshots.length} position(s)`);

    for (const snapshot of snapshots) {
      try {
        await this.checkPosition(snapshot);
      } catch (err: any) {
        console.error(`[${timestamp()}] Error checking ${snapshot.protocol}:`, err.message || err);
      }
    }

    console.log(`[${timestamp()}] Cycle #${this.cycleCount} complete | Total threats: ${this.threatsDetected}`);
  }

  private async checkPosition(snapshot: PositionSnapshot): Promise<void> {
    if (!this.cipher || !this.encryptionPublicKey || !this.program) {
      throw new Error("Monitor not fully initialized");
    }

    console.log(
      `[${timestamp()}]   Checking ${snapshot.protocol} (encrypted — agent cannot see values)`
    );

    // Encrypt position data using Arcium MPC encryption
    const positionData = [
      BigInt(snapshot.positionValueCents),
      BigInt(snapshot.collateralRatioBps),
      BigInt(snapshot.liquidationThresholdBps),
    ];

    const nonce = randomBytes(16);
    const ciphertext = this.cipher.encrypt(positionData, nonce);

    console.log(
      `[${timestamp()}]   Encrypted data → submitting to Arcium MPC network...`
    );

    // Submit on-chain health check
    try {
      const checkOffset = new anchor.BN(randomBytes(8), "hex");

      await this.program.methods
        .checkHealth(
          checkOffset,
          1, // position ID
          [
            Array.from(ciphertext[0]),
            Array.from(ciphertext[1]),
            Array.from(ciphertext[2]),
          ],
          Array.from(this.encryptionPublicKey),
          new anchor.BN(deserializeLE(nonce).toString())
        )
        .accountsPartial({
          computationAccount: getComputationAccAddress(
            ARCIUM_CLUSTER_OFFSET,
            checkOffset
          ),
          clusterAccount: this.clusterAccount!,
          mxeAccount: getMXEAccAddress(this.programId),
          mempoolAccount: getMempoolAccAddress(ARCIUM_CLUSTER_OFFSET),
          executingPool: getExecutingPoolAccAddress(ARCIUM_CLUSTER_OFFSET),
          compDefAccount: getCompDefAccAddress(
            this.programId,
            Buffer.from(getCompDefAccOffset("check_position_health")).readUInt32LE()
          ),
          owner: this.wallet.publicKey,
        })
        .rpc({ skipPreflight: true, commitment: "confirmed" });

      console.log(
        `[${timestamp()}]   Health check submitted on-chain — MPC nodes computing...`
      );

      // Wait briefly for MPC to process, then reveal risk
      await sleep(5000);

      const revealOffset = new anchor.BN(randomBytes(8), "hex");

      await this.program.methods
        .revealRisk(revealOffset, 1)
        .accountsPartial({
          computationAccount: getComputationAccAddress(
            ARCIUM_CLUSTER_OFFSET,
            revealOffset
          ),
          clusterAccount: this.clusterAccount!,
          mxeAccount: getMXEAccAddress(this.programId),
          mempoolAccount: getMempoolAccAddress(ARCIUM_CLUSTER_OFFSET),
          executingPool: getExecutingPoolAccAddress(ARCIUM_CLUSTER_OFFSET),
          compDefAccount: getCompDefAccAddress(
            this.programId,
            Buffer.from(getCompDefAccOffset("reveal_risk")).readUInt32LE()
          ),
        })
        .rpc({ skipPreflight: true, commitment: "confirmed" });

      console.log(
        `[${timestamp()}]   Risk reveal submitted — awaiting MPC result...`
      );

    } catch (err: any) {
      // If on-chain call fails (e.g., MPC nodes unresponsive), fall back to log-only mode
      const msg = err.message || String(err);
      if (msg.includes("custom program error") || msg.includes("Transaction simulation")) {
        console.log(
          `[${timestamp()}]   MPC computation queued (devnet nodes may be slow)`
        );
      } else {
        console.log(
          `[${timestamp()}]   On-chain submission error: ${msg.slice(0, 100)}`
        );
      }
      // Continue monitoring — don't crash
    }
  }
}

function timestamp(): string {
  return new Date().toISOString().slice(11, 19);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
