import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { Sentinel } from "../target/types/sentinel";
import { randomBytes, createHash } from "crypto";
import nacl from "tweetnacl";
import {
  awaitComputationFinalization,
  getArciumEnv,
  getCompDefAccOffset,
  getArciumAccountBaseSeed,
  getArciumProgramId,
  uploadCircuit,
  RescueCipher,
  deserializeLE,
  getMXEAccAddress,
  getMempoolAccAddress,
  getCompDefAccAddress,
  getExecutingPoolAccAddress,
  x25519,
  getComputationAccAddress,
  getMXEPublicKey,
  getClusterAccAddress,
  getLookupTableAddress,
  getArciumProgram,
} from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";
import { expect } from "chai";

const ENCRYPTION_KEY_MESSAGE = "fold-defi-encryption-key-v1";

function deriveEncryptionKey(
  wallet: anchor.web3.Keypair,
  message: string
): { privateKey: Uint8Array; publicKey: Uint8Array } {
  const messageBytes = new TextEncoder().encode(message);
  const signature = nacl.sign.detached(messageBytes, wallet.secretKey);
  const privateKey = new Uint8Array(
    createHash("sha256").update(signature).digest()
  );
  const publicKey = x25519.getPublicKey(privateKey);
  return { privateKey, publicKey };
}

describe("Fold DeFi Security Agent", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.Sentinel as Program<Sentinel>;
  const provider = anchor.getProvider();

  type Event = anchor.IdlEvents<(typeof program)["idl"]>;
  const awaitEvent = async <E extends keyof Event>(
    eventName: E
  ): Promise<Event[E]> => {
    let listenerId: number;
    const event = await new Promise<Event[E]>((res) => {
      listenerId = program.addEventListener(eventName, (event) => {
        res(event);
      });
    });
    await program.removeEventListener(listenerId);
    return event;
  };

  const arciumEnv = getArciumEnv();
  const clusterAccount = getClusterAccAddress(arciumEnv.arciumClusterOffset);

  it("monitors positions and detects risk", async () => {
    const POSITION_ID = 1;
    const owner = readKpJson(`${os.homedir()}/.config/solana/id.json`);

    const mxePublicKey = await getMXEPublicKeyWithRetry(
      provider as anchor.AnchorProvider,
      program.programId
    );
    console.log("MXE x25519 pubkey:", mxePublicKey);

    // Initialize computation definitions
    console.log("Initializing computation definitions...");
    await initCompDef(program, owner, "init_risk_state", "initRiskStateCompDef");
    await initCompDef(program, owner, "check_position_health", "initCheckHealthCompDef");
    await initCompDef(program, owner, "reveal_risk", "initRevealRiskCompDef");
    console.log("All computation definitions initialized");

    // Derive encryption keys
    const { privateKey, publicKey } = deriveEncryptionKey(owner, ENCRYPTION_KEY_MESSAGE);
    const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
    const cipher = new RescueCipher(sharedSecret);

    // Register position for monitoring
    console.log("Registering position...");
    const registerNonce = randomBytes(16);
    const registerOffset = new anchor.BN(randomBytes(8), "hex");

    const registerSig = await program.methods
      .registerPosition(
        registerOffset,
        POSITION_ID,
        new anchor.BN(deserializeLE(registerNonce).toString())
      )
      .accountsPartial({
        computationAccount: getComputationAccAddress(
          arciumEnv.arciumClusterOffset,
          registerOffset
        ),
        clusterAccount,
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
        executingPool: getExecutingPoolAccAddress(arciumEnv.arciumClusterOffset),
        compDefAccount: getCompDefAccAddress(
          program.programId,
          Buffer.from(getCompDefAccOffset("init_risk_state")).readUInt32LE()
        ),
      })
      .rpc({ skipPreflight: true, commitment: "confirmed" });

    console.log("Position registered:", registerSig);
    await awaitComputationFinalization(
      provider as anchor.AnchorProvider,
      registerOffset,
      program.programId,
      "confirmed"
    );

    // Simulate a health check with a risky position
    // Position: $5000, 115% collateral, 110% liquidation threshold
    // This is within the 5% danger zone -> should be critical risk
    console.log("Submitting encrypted health check (risky position)...");
    const positionData = [
      BigInt(500000),  // $5000 in cents
      BigInt(11500),   // 115% collateral ratio
      BigInt(11000),   // 110% liquidation threshold
    ];

    const checkNonce = randomBytes(16);
    const ciphertext = cipher.encrypt(positionData, checkNonce);

    const checkOffset = new anchor.BN(randomBytes(8), "hex");
    const healthCheckEventPromise = awaitEvent("healthCheckCompleted");

    await program.methods
      .checkHealth(
        checkOffset,
        POSITION_ID,
        [
          Array.from(ciphertext[0]),
          Array.from(ciphertext[1]),
          Array.from(ciphertext[2]),
        ],
        Array.from(publicKey),
        new anchor.BN(deserializeLE(checkNonce).toString())
      )
      .accountsPartial({
        computationAccount: getComputationAccAddress(
          arciumEnv.arciumClusterOffset,
          checkOffset
        ),
        clusterAccount,
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
        executingPool: getExecutingPoolAccAddress(arciumEnv.arciumClusterOffset),
        compDefAccount: getCompDefAccAddress(
          program.programId,
          Buffer.from(getCompDefAccOffset("check_position_health")).readUInt32LE()
        ),
        owner: owner.publicKey,
      })
      .rpc({ skipPreflight: true, commitment: "confirmed" });

    await awaitComputationFinalization(
      provider as anchor.AnchorProvider,
      checkOffset,
      program.programId,
      "confirmed"
    );

    const healthEvent = await healthCheckEventPromise;
    console.log("Health check completed at:", healthEvent.timestamp.toString());

    // Reveal risk
    console.log("Revealing risk status...");
    const revealOffset = new anchor.BN(randomBytes(8), "hex");
    const riskEventPromise = awaitEvent("riskRevealed");

    await program.methods
      .revealRisk(revealOffset, POSITION_ID)
      .accountsPartial({
        computationAccount: getComputationAccAddress(
          arciumEnv.arciumClusterOffset,
          revealOffset
        ),
        clusterAccount,
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
        executingPool: getExecutingPoolAccAddress(arciumEnv.arciumClusterOffset),
        compDefAccount: getCompDefAccAddress(
          program.programId,
          Buffer.from(getCompDefAccOffset("reveal_risk")).readUInt32LE()
        ),
      })
      .rpc({ skipPreflight: true, commitment: "confirmed" });

    await awaitComputationFinalization(
      provider as anchor.AnchorProvider,
      revealOffset,
      program.programId,
      "confirmed"
    );

    const riskEvent = await riskEventPromise;
    console.log("Position at risk:", riskEvent.isAtRisk);
    expect(riskEvent.isAtRisk).to.equal(true);
  });

  async function initCompDef(
    program: Program<Sentinel>,
    owner: anchor.web3.Keypair,
    circuitName: string,
    methodName: string
  ): Promise<string> {
    const baseSeed = getArciumAccountBaseSeed("ComputationDefinitionAccount");
    const offset = getCompDefAccOffset(circuitName);
    const compDefPDA = PublicKey.findProgramAddressSync(
      [baseSeed, program.programId.toBuffer(), offset],
      getArciumProgramId()
    )[0];

    const arciumProgram = getArciumProgram(provider as anchor.AnchorProvider);
    const mxeAccount = getMXEAccAddress(program.programId);
    const mxeAcc = await arciumProgram.account.mxeAccount.fetch(mxeAccount);
    const lutAddress = getLookupTableAddress(program.programId, mxeAcc.lutOffsetSlot);

    // Check if comp def already exists (for devnet re-runs)
    const compDefInfo = await provider.connection.getAccountInfo(compDefPDA);
    if (compDefInfo) {
      console.log(`${circuitName} comp def already initialized, skipping`);
    } else {
      const sig = await (program.methods as any)
        [methodName]()
        .accounts({
          compDefAccount: compDefPDA,
          payer: owner.publicKey,
          mxeAccount,
          addressLookupTable: lutAddress,
        })
        .signers([owner])
        .rpc({ commitment: "confirmed" });
      console.log(`Initialized ${circuitName} comp def:`, sig);
    }

    const rawCircuit = fs.readFileSync(`build/${circuitName}.arcis`);
    await uploadCircuit(
      provider as anchor.AnchorProvider,
      circuitName,
      program.programId,
      rawCircuit,
      true
    );

    return "ok";
  }
});

async function getMXEPublicKeyWithRetry(
  provider: anchor.AnchorProvider,
  programId: PublicKey,
  maxRetries: number = 20,
  retryDelayMs: number = 500
): Promise<Uint8Array> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const key = await getMXEPublicKey(provider, programId);
      if (key) return key;
    } catch (error) {
      console.log(`Attempt ${attempt} failed:`, error);
    }
    if (attempt < maxRetries) {
      await new Promise((r) => setTimeout(r, retryDelayMs));
    }
  }
  throw new Error(`Failed to fetch MXE public key after ${maxRetries} attempts`);
}

function readKpJson(path: string): anchor.web3.Keypair {
  const file = fs.readFileSync(path);
  return anchor.web3.Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(file.toString()))
  );
}
