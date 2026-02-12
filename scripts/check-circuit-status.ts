import * as anchor from "@coral-xyz/anchor";
import {
  getCompDefAccOffset,
  getArciumAccountBaseSeed,
  getArciumProgramId,
  getArciumProgram,
} from "@arcium-hq/client";

const PROGRAM_ID = new anchor.web3.PublicKey("ABDZr3DvUSnugBNrAj8vaAhKt3tHafA82MDja812QbJC");

async function main() {
  const connection = new anchor.web3.Connection(
    process.env.ANCHOR_PROVIDER_URL!,
    "confirmed"
  );
  const wallet = anchor.Wallet.local();
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const arciumProgram = getArciumProgram(provider);
  const baseSeed = getArciumAccountBaseSeed("ComputationDefinitionAccount");

  for (const circuitName of ["init_risk_state", "check_position_health", "reveal_risk"]) {
    const offset = getCompDefAccOffset(circuitName);
    const compDefPDA = anchor.web3.PublicKey.findProgramAddressSync(
      [baseSeed, PROGRAM_ID.toBuffer(), offset],
      getArciumProgramId()
    )[0];

    try {
      const compDefAcc = await arciumProgram.account.computationDefinitionAccount.fetch(compDefPDA);
      const circuitSource = compDefAcc.circuitSource as any;

      let state: string;
      if (!('onChain' in circuitSource) || !circuitSource.onChain) {
        state = 'Offchain';
      } else if (circuitSource.onChain[0].isCompleted) {
        state = 'OnchainFinalized';
      } else {
        state = 'OnchainPending';
      }

      console.log(`${circuitName}: ${state} (PDA: ${compDefPDA.toBase58()})`);
    } catch (e: any) {
      if (e.message?.includes("Account does not exist")) {
        console.log(`${circuitName}: NOT INITIALIZED`);
      } else {
        console.log(`${circuitName}: ERROR - ${e.message}`);
      }
    }
  }

  const balance = await connection.getBalance(wallet.publicKey);
  console.log(`\nWallet balance: ${balance / 1e9} SOL`);
}

main().catch(console.error);
