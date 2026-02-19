import {
  Keypair,
  LAMPORTS_PER_SOL,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { connection } from "../config";
import { sleep, waitForConfirmation } from "../core/utils";

const BATCH_SIZE = 8;
/** Leave this much SOL in each wallet (rent + tx fee buffer). */
const MIN_KEEP_SOL = 0.001;

export async function gatherSolToMain(
  mainWallet: Keypair,
  bundlerKeypairs: Keypair[]
): Promise<{ gatheredSol: number; txCount: number }> {
  const mainAddress = mainWallet.publicKey;
  let gatheredSol = 0;
  let txCount = 0;
  const minKeepLamports = Math.ceil(MIN_KEEP_SOL * LAMPORTS_PER_SOL);
  const feeLamports = 5000;

  const walletsWithBalance: { keypair: Keypair; lamports: number }[] = [];
  for (const kp of bundlerKeypairs) {
    const lamports = await connection.getBalance(kp.publicKey, "confirmed");
    const toSend = lamports - minKeepLamports - feeLamports;
    if (toSend > 0) {
      walletsWithBalance.push({ keypair: kp, lamports });
    }
  }

  if (walletsWithBalance.length === 0) {
    console.log("No bundler wallets with sufficient balance to gather.");
    return { gatheredSol: 0, txCount: 0 };
  }

  const batches = Math.ceil(walletsWithBalance.length / BATCH_SIZE);
  for (let b = 0; b < batches; b++) {
    const start = b * BATCH_SIZE;
    const slice = walletsWithBalance.slice(start, start + BATCH_SIZE);
    const transferIxs = slice.map(({ keypair, lamports }, i) => {
      const isFirstInTx = i === 0;
      const keep = minKeepLamports + (isFirstInTx ? feeLamports : 0);
      const transferLamports = Math.max(0, lamports - keep);
      if (transferLamports <= 0) return null;
      return SystemProgram.transfer({
        fromPubkey: keypair.publicKey,
        toPubkey: mainAddress,
        lamports: transferLamports,
      });
    }).filter((ix): ix is NonNullable<typeof ix> => ix != null);

    if (transferIxs.length === 0) continue;

    let batchLamports = 0;
    slice.forEach(({ lamports }, i) => {
      const keep = minKeepLamports + (i === 0 ? feeLamports : 0);
      batchLamports += Math.max(0, lamports - keep);
    });

    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    const msg = new TransactionMessage({
      payerKey: slice[0].keypair.publicKey,
      recentBlockhash: blockhash,
      instructions: transferIxs,
    }).compileToV0Message();
    const tx = new VersionedTransaction(msg);
    tx.sign(slice.map((s) => s.keypair));

    const sig = await connection.sendTransaction(tx, { skipPreflight: false });
    gatheredSol += batchLamports / LAMPORTS_PER_SOL;
    txCount += 1;
    console.log(`Gather batch ${b + 1}/${batches}, sig: ${sig}`);
    await waitForConfirmation(sig);
    await sleep(600);
  }

  return { gatheredSol, txCount };
}
