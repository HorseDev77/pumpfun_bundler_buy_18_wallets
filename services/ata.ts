import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  AddressLookupTableAccount,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { connection } from "../config";
import { sleep } from "../core/utils";

// Pump.fun uses allowOwnerOffCurve: true for user ATAs (must match SDK and LUT)
export function getAtaAddress(owner: PublicKey, mint: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, owner, true);
}

export async function createAtaInstructions(
  mint: PublicKey,
  owners: PublicKey[],
  payer: PublicKey
): Promise<{ instructions: ReturnType<typeof createAssociatedTokenAccountInstruction>[]; needCreate: PublicKey[] }> {
  const instructions: ReturnType<typeof createAssociatedTokenAccountInstruction>[] = [];
  const needCreate: PublicKey[] = [];

  for (const owner of owners) {
    const ata = getAtaAddress(owner, mint);
    const acc = await connection.getAccountInfo(ata);
    if (!acc) {
      needCreate.push(ata);
      instructions.push(
        createAssociatedTokenAccountInstruction(payer, ata, owner, mint)
      );
    }
  }
  return { instructions, needCreate };
}

/** Build create-ATA instructions for all owners (no on-chain check). For use in one bundle with create token + buy. */
export function buildCreateAtaInstructionsForOwners(
  mint: PublicKey,
  owners: PublicKey[],
  payer: PublicKey
): import("@solana/web3.js").TransactionInstruction[] {
  const instructions: ReturnType<typeof createAssociatedTokenAccountInstruction>[] = [];
  for (const owner of owners) {
    const ata = getAtaAddress(owner, mint);
    instructions.push(
      createAssociatedTokenAccountInstruction(payer, ata, owner, mint)
    );
  }
  return instructions;
}

/** Build create-ATA VersionedTransactions for bundle (batched, with LUT). */
export function buildCreateAtaTransactions(
  mint: PublicKey,
  walletKeypairs: Keypair[],
  payer: Keypair,
  blockhash: string,
  lookupTable: AddressLookupTableAccount
): VersionedTransaction[] {
  const owners = walletKeypairs.map((w) => w.publicKey);
  const allIxs = buildCreateAtaInstructionsForOwners(mint, owners, payer.publicKey);
  /** Max ATAs per 5tx to stay under Solana size limit (~1232 bytes). Each create-ATA ix = 6 account keys (32B each if not in LUT). */
  const BATCH = 5;
  const txs: VersionedTransaction[] = [];
  for (let i = 0; i < allIxs.length; i += BATCH) {
    const slice = allIxs.slice(i, i + BATCH);
    const msg = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: blockhash,
      instructions: slice,
    }).compileToV0Message([lookupTable]);
    const tx = new VersionedTransaction(msg);
    tx.sign([payer]);
    txs.push(tx);
  }
  return txs;
}

export async function createAtasForWallets(
  mint: PublicKey,
  walletKeypairs: Keypair[],
  payer: Keypair,
  lookupTable?: AddressLookupTableAccount | null
): Promise<void> {
  const owners = walletKeypairs.map((w) => w.publicKey);
  const { instructions, needCreate } = await createAtaInstructions(mint, owners, payer.publicKey);
  if (needCreate.length === 0) {
    console.log("All ATAs already exist.");
    return;
  }
  const BATCH = 6;
  const blockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
  for (let i = 0; i < instructions.length; i += BATCH) {
    const slice = instructions.slice(i, i + BATCH);
    const msg = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: blockhash,
      instructions: slice,
    });
    const messageV0 = lookupTable
      ? msg.compileToV0Message([lookupTable])
      : msg.compileToV0Message();
    const tx = new VersionedTransaction(messageV0);
    tx.sign([payer]);
    const sig = await connection.sendTransaction(tx, { skipPreflight: false });
    console.log("Create ATA batch sig:", sig, lookupTable ? "(with LUT)" : "");
    await sleep(400);
  }
  console.log("ATAs created.");
}
