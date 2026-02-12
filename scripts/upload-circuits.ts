import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { Sentinel } from "../target/types/sentinel";
import {
  getCompDefAccOffset,
  getArciumAccountBaseSeed,
  getArciumProgramId,
  uploadCircuit,
  getMXEAccAddress,
  getLookupTableAddress,
  getArciumProgram,
  getCompDefAccAddress,
} from "@arcium-hq/client";
import * as fs from "fs";

const PROGRAM_ID = new PublicKey("ABDZr3DvUSnugBNrAj8vaAhKt3tHafA82MDja812QbJC");
const CHUNK_SIZE = 3; // Very small to avoid 429s on free-tier RPC

async function main() {
  const connection = new anchor.web3.Connection(
    process.env.ANCHOR_PROVIDER_URL!,
    { commitment: "confirmed", confirmTransactionInitialTimeout: 120000 }
  );
  const wallet = anchor.Wallet.local();
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  anchor.setProvider(provider);

  const program = anchor.workspace.Sentinel as anchor.Program<Sentinel>;

  // 1. Upload check_position_health (OnchainPending — resize done, needs data upload + finalize)
  console.log("=== Uploading check_position_health circuit ===");
  const checkRaw = fs.readFileSync("build/check_position_health.arcis");
  console.log(`Circuit size: ${checkRaw.length} bytes`);
  try {
    const sigs = await uploadCircuit(
      provider,
      "check_position_health",
      PROGRAM_ID,
      checkRaw,
      true,
      CHUNK_SIZE
    );
    console.log(`check_position_health uploaded: ${sigs.length} txs`);
  } catch (e: any) {
    console.error("check_position_health upload failed:", e.message);
    // If it fails, check status again — might have partially succeeded
  }

  // 2. Init reveal_risk comp def
  console.log("\n=== Initializing reveal_risk comp def ===");
  const baseSeed = getArciumAccountBaseSeed("ComputationDefinitionAccount");
  const revealOffset = getCompDefAccOffset("reveal_risk");
  const revealCompDefPDA = PublicKey.findProgramAddressSync(
    [baseSeed, PROGRAM_ID.toBuffer(), revealOffset],
    getArciumProgramId()
  )[0];

  const compDefInfo = await provider.connection.getAccountInfo(revealCompDefPDA);
  if (compDefInfo) {
    console.log("reveal_risk comp def already initialized, skipping");
  } else {
    const arciumProgram = getArciumProgram(provider);
    const mxeAccount = getMXEAccAddress(PROGRAM_ID);
    const mxeAcc = await arciumProgram.account.mxeAccount.fetch(mxeAccount);
    const lutAddress = getLookupTableAddress(PROGRAM_ID, mxeAcc.lutOffsetSlot);

    const sig = await (program.methods as any)
      .initRevealRiskCompDef()
      .accounts({
        compDefAccount: revealCompDefPDA,
        payer: wallet.publicKey,
        mxeAccount,
        addressLookupTable: lutAddress,
      })
      .rpc({ commitment: "confirmed" });
    console.log("Initialized reveal_risk comp def:", sig);

    // Wait a moment for confirmation
    await new Promise((r) => setTimeout(r, 3000));
  }

  // 3. Upload reveal_risk circuit
  console.log("\n=== Uploading reveal_risk circuit ===");
  const revealRaw = fs.readFileSync("build/reveal_risk.arcis");
  console.log(`Circuit size: ${revealRaw.length} bytes`);
  try {
    const sigs = await uploadCircuit(
      provider,
      "reveal_risk",
      PROGRAM_ID,
      revealRaw,
      true,
      CHUNK_SIZE
    );
    console.log(`reveal_risk uploaded: ${sigs.length} txs`);
  } catch (e: any) {
    console.error("reveal_risk upload failed:", e.message);
  }

  // Final status check
  console.log("\n=== Final Status ===");
  const arciumProgram = getArciumProgram(provider);
  for (const name of ["init_risk_state", "check_position_health", "reveal_risk"]) {
    const offset = getCompDefAccOffset(name);
    const pda = PublicKey.findProgramAddressSync(
      [baseSeed, PROGRAM_ID.toBuffer(), offset],
      getArciumProgramId()
    )[0];
    try {
      const acc = await arciumProgram.account.computationDefinitionAccount.fetch(pda);
      const src = acc.circuitSource as any;
      let state = 'Offchain';
      if ('onChain' in src && src.onChain) {
        state = src.onChain[0].isCompleted ? 'OnchainFinalized' : 'OnchainPending';
      }
      console.log(`${name}: ${state}`);
    } catch {
      console.log(`${name}: NOT INITIALIZED`);
    }
  }

  const balance = await connection.getBalance(wallet.publicKey);
  console.log(`Wallet balance: ${balance / 1e9} SOL`);
}

main().catch(console.error);
