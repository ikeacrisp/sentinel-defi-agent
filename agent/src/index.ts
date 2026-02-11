import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { SentinelMonitor } from "./monitor";
import { AlertService } from "./alerts";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as os from "os";

dotenv.config();

const CONFIG = {
  rpcUrl: process.env.SOLANA_RPC_URL || "https://devnet.helius-rpc.com/?api-key=YOUR_KEY",
  programId: process.env.PROGRAM_ID || "SentDeFi11111111111111111111111111111111111",
  checkIntervalMs: parseInt(process.env.CHECK_INTERVAL_MS || "30000"),
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || "",
  telegramChatId: process.env.TELEGRAM_CHAT_ID || "",
  walletPath: process.env.WALLET_PATH || `${os.homedir()}/.config/solana/id.json`,
};

async function main() {
  console.log("=".repeat(60));
  console.log("  Sentinel DeFi Security Agent");
  console.log("  Privacy-Preserving Position Monitoring via Arcium MPC");
  console.log("=".repeat(60));
  console.log();

  // Load wallet
  const walletData = JSON.parse(fs.readFileSync(CONFIG.walletPath, "utf-8"));
  const wallet = Keypair.fromSecretKey(new Uint8Array(walletData));
  console.log(`Agent wallet: ${wallet.publicKey.toBase58()}`);

  // Connect to Solana
  const connection = new Connection(CONFIG.rpcUrl, "confirmed");
  const balance = await connection.getBalance(wallet.publicKey);
  console.log(`Balance: ${balance / 1e9} SOL`);

  // Initialize alert service
  const alertService = new AlertService(
    CONFIG.telegramBotToken,
    CONFIG.telegramChatId
  );

  // Initialize monitor
  const monitor = new SentinelMonitor(
    connection,
    wallet,
    new PublicKey(CONFIG.programId),
    alertService,
    CONFIG.checkIntervalMs
  );

  // Handle shutdown
  process.on("SIGINT", () => {
    console.log("\nShutting down Sentinel agent...");
    monitor.stop();
    process.exit(0);
  });

  // Start monitoring
  console.log(`\nStarting monitoring loop (every ${CONFIG.checkIntervalMs / 1000}s)...`);
  console.log("Press Ctrl+C to stop\n");
  await monitor.start();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
