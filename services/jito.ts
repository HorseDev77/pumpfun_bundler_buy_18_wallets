import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import axios, { AxiosError } from "axios";
import { connection } from "../config";
import {
  JITO_FEE_LAMPORTS,
  JITO_BLOCK_ENGINE_URL,
  isMainnet,
  JITO_SIMULATE_ONLY,
} from "../config";
import { waitForConfirmation } from "../core/utils";

const JITO_TIP_ACCOUNTS = [
  "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
  "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
  "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
  "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT",
  "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
  "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
  "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
  "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
];

/** Jito tip account addresses for LUT (mainnet). */
export function getJitoTipAccountPublicKeys(): PublicKey[] {
  return JITO_TIP_ACCOUNTS.map((a) => new PublicKey(a));
}

/** Returns the Jito tip transfer instruction to prepend to the first bundle tx (mainnet). */
export function getJitoTipInstruction(payer: PublicKey): TransactionInstruction {
  const tipAccounts = getJitoTipAccountPublicKeys();
  const tipAccount = tipAccounts[Math.floor(Math.random() * tipAccounts.length)];
  return SystemProgram.transfer({
    fromPubkey: payer,
    toPubkey: tipAccount,
    lamports: JITO_FEE_LAMPORTS,
  });
}

export interface JitoBundleResult {
  confirmed: boolean;
  tipSignature?: string;
  simulationPassed?: boolean;
}

/** Simulate only the first bundle tx (create token). Later txs depend on tx 1's mint so they fail simulation with "Invalid Mint" against current state. */
export async function simulateBundle(
  transactions: VersionedTransaction[]
): Promise<{ success: boolean; failedIndex?: number; error?: string; logs?: string[] }> {
  if (transactions.length === 0) return { success: true };
  try {
    const result = await connection.simulateTransaction(transactions[1], {
      sigVerify: false,
      replaceRecentBlockhash: true,
    });
    const err = result.value.err;
    if (err) {
      const logs = result.value.logs ?? [];
      return {
        success: false,
        failedIndex: 0,
        error: typeof err === "object" ? JSON.stringify(err) : String(err),
        logs,
      };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, failedIndex: 0, error: msg };
  }
  return { success: true };
}

export async function sendJitoBundle(
  transactions: VersionedTransaction[],
  _tipPayer: Keypair
): Promise<JitoBundleResult> {
  if (!isMainnet) {
    console.log("Jito bundle skipped (devnet). Submit txs manually if needed.");
    return { confirmed: false };
  }

  console.log("Simulating bundle (tx 1 only; later txs depend on mint from tx 1)...");
  const sim = await simulateBundle(transactions);
  if (!sim.success) {
    console.error(
      "Bundle simulation failed at tx",
      (sim.failedIndex ?? 0) + 1,
      ":",
      sim.error
    );
    if (sim.logs?.length) console.error("Logs:", sim.logs.slice(-20).join("\n"));
    return { confirmed: false, simulationPassed: false };
  }
  console.log("Bundle simulation passed.");

  if (JITO_SIMULATE_ONLY) {
    console.log("JITO_SIMULATE_ONLY=true: skipping send to Jito.");
    return { confirmed: false, simulationPassed: true };
  }

  const serialized = transactions.map((t) => bs58.encode(t.serialize()));

  try {
    const { data } = await axios.post(
      JITO_BLOCK_ENGINE_URL,
      { jsonrpc: "2.0", id: 1, method: "sendBundle", params: [serialized] },
      { timeout: 15_000 }
    );
    if (data?.result?.value) {
      const firstSig = bs58.encode(transactions[0].signatures[0]);
      await waitForConfirmation(firstSig, { timeoutMs: 60_000 });
      return { confirmed: true, tipSignature: firstSig, simulationPassed: true };
    }
  } catch (e) {
    if (e instanceof AxiosError) console.error("Jito bundle error:", e.message);
    else console.error(e);
  }
  return { confirmed: false, simulationPassed: true };
}
