import {
  createCloseAccountInstruction,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { ComputeBudgetProgram } from "@solana/web3.js";
import { connection } from "../config";
import { sleep, waitForConfirmation } from "../core/utils";

const LAMPORTS_PER_SOL = 1e9;
/** Max close-account instructions per tx (stay under tx size). */
const CLOSE_BATCH_SIZE = 8;

export interface CloseAtasResult {
  closedCount: number;
  reclaimedSol: number;
  txCount: number;
  skippedNonZero: number;
}

/**
 * Fetch all token accounts (ATAs) owned by `owner` for both Token and Token-2022,
 * then close those with zero balance and reclaim rent to `destination` (usually owner).
 * Returns closed count, reclaimed SOL, and tx count. Skips accounts with non-zero balance.
 */
export async function closeMainWalletAtas(
  owner: Keypair,
  destination: PublicKey
): Promise<CloseAtasResult> {
  const ownerPubkey = owner.publicKey;
  const programs = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID];
  const accountsToClose: { address: PublicKey; programId: PublicKey }[] = [];
  let skippedNonZero = 0;

  for (const programId of programs) {
    const res = await connection.getParsedTokenAccountsByOwner(ownerPubkey, {
      programId,
    });
    for (const { pubkey, account } of res.value) {
      const parsed = account.data?.parsed;
      const info = parsed?.info;
      const amount = info?.tokenAmount?.amount;
      if (amount === undefined) continue;
      if (amount !== "0") {
        skippedNonZero += 1;
        continue;
      }
      accountsToClose.push({ address: pubkey, programId });
    }
  }

  if (skippedNonZero > 0) {
    console.log(skippedNonZero, "token account(s) have non-zero balance (skipped; close manually or send tokens first).");
  }
  if (accountsToClose.length === 0) {
    console.log("No zero-balance token accounts to close.");
    return { closedCount: 0, reclaimedSol: 0, txCount: 0, skippedNonZero };
  }

  console.log("Closing", accountsToClose.length, "zero-balance ATAs, reclaiming rent to", destination.toBase58());

  const instructions: TransactionInstruction[] = accountsToClose.map(
    ({ address, programId }) =>
      createCloseAccountInstruction(
        address,
        destination,
        ownerPubkey,
        [],
        programId
      )
  );

  let txCount = 0;
  const rentPerAta = 2039280; // min rent for token account
  const reclaimedSol = (accountsToClose.length * rentPerAta) / LAMPORTS_PER_SOL;

  for (let i = 0; i < instructions.length; i += CLOSE_BATCH_SIZE) {
    const slice = instructions.slice(i, i + CLOSE_BATCH_SIZE);
    const msg = new TransactionMessage({
      payerKey: ownerPubkey,
      recentBlockhash: (await connection.getLatestBlockhash("confirmed")).blockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
        ...slice,
      ],
    }).compileToV0Message();
    const tx = new VersionedTransaction(msg);
    tx.sign([owner]);
    const sig = await connection.sendTransaction(tx, { skipPreflight: false });
    txCount += 1;
    console.log("Close ATAs batch", txCount, "sig:", sig);
    await waitForConfirmation(sig);
    await sleep(500);
  }

  return {
    closedCount: accountsToClose.length,
    reclaimedSol,
    txCount,
    skippedNonZero,
  };
}
