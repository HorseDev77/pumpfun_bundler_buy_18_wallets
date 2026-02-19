import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import axios, { AxiosError } from "axios";
import { connection } from "../config";
import { JITO_FEE_LAMPORTS, JITO_BLOCK_ENGINE_URL, isMainnet } from "../config";
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

export interface JitoBundleResult {
  confirmed: boolean;
  tipSignature?: string;
}

export async function sendJitoBundle(
  transactions: VersionedTransaction[],
  tipPayer: Keypair
): Promise<JitoBundleResult> {
  if (!isMainnet) {
    console.log("Jito bundle skipped (devnet). Submit txs manually if needed.");
    return { confirmed: false };
  }

  const tipAccount = JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)];
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const tipMessage = new TransactionMessage({
    payerKey: tipPayer.publicKey,
    recentBlockhash: blockhash,
    instructions: [
      SystemProgram.transfer({
        fromPubkey: tipPayer.publicKey,
        toPubkey: new PublicKey(tipAccount),
        lamports: JITO_FEE_LAMPORTS,
      }),
    ],
  }).compileToV0Message();
  const tipTx = new VersionedTransaction(tipMessage);
  tipTx.sign([tipPayer]);
  const tipSignature = bs58.encode(tipTx.signatures[0]);

  const serialized = [bs58.encode(tipTx.serialize()), ...transactions.map((t) => bs58.encode(t.serialize()))];

  try {
    const { data } = await axios.post(
      JITO_BLOCK_ENGINE_URL,
      { jsonrpc: "2.0", id: 1, method: "sendBundle", params: [serialized] },
      { timeout: 15_000 }
    );
    if (data?.result?.value) {
      await waitForConfirmation(tipSignature, { timeoutMs: 60_000 });
      return { confirmed: true, tipSignature };
    }
  } catch (e) {
    if (e instanceof AxiosError) console.error("Jito bundle error:", e.message);
    else console.error(e);
  }
  return { confirmed: false };
}
