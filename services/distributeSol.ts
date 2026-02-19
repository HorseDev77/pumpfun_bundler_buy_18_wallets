import {
  Keypair,
  LAMPORTS_PER_SOL,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { connection } from "../config";
import { SOL_DISTRIBUTE_MIN, SOL_DISTRIBUTE_MAX } from "../config";
import { randomInRange, sleep, waitForConfirmation } from "../core/utils";

const BATCH_SIZE = 8;
const RENT_BUFFER_SOL = 0.005;

function randomLamports(minSol: number, maxSol: number): number {
  const sol = randomInRange(minSol, maxSol);
  return Math.floor(sol * LAMPORTS_PER_SOL);
}

export async function distributeSolToWallets(
  payer: Keypair,
  wallets: Keypair[]
): Promise<void> {
  const totalWallets = wallets.length;
  const batches = Math.ceil(totalWallets / BATCH_SIZE);

  for (let b = 0; b < batches; b++) {
    const start = b * BATCH_SIZE;
    const end = Math.min(start + BATCH_SIZE, totalWallets);
    const slice = wallets.slice(start, end);

    const ixs = slice.map((w) =>
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: w.publicKey,
        lamports: randomLamports(SOL_DISTRIBUTE_MIN, SOL_DISTRIBUTE_MAX) + Math.ceil(RENT_BUFFER_SOL * LAMPORTS_PER_SOL),
      })
    );

    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    const msg = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: blockhash,
      instructions: ixs,
    }).compileToV0Message();
    const tx = new VersionedTransaction(msg);
    tx.sign([payer]);

    const sig = await connection.sendTransaction(tx, { skipPreflight: false });
    console.log(`Distributed SOL batch ${b + 1}/${batches}, sig: ${sig}`);
    await waitForConfirmation(sig);
    await sleep(800);
  }
  console.log("SOL distribution done.");
}
