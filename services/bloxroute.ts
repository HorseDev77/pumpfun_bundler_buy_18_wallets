import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import axios, { AxiosError } from "axios";
import {
  BLOXROUTE_API_URL,
  BLOXROUTE_AUTH_HEADER,
  BLOXROUTE_TIP_LAMPORTS,
  isMainnet,
} from "../config";
import { waitForConfirmation } from "../core/utils";
import { simulateBundle } from "./jito";

/** Official BloxRoute tip-receiving addresses (rotate to reduce contention). Min tip 0.001 SOL. */
export const BLOXROUTE_TIP_ACCOUNTS = [
  "HWEoBxYs7ssKuudEjzjmpfJVX7Dvi7wescFsVx2L5yoY",
];

/** BloxRoute tip account pubkeys for LUT (mainnet). */
export function getBloxRouteTipAccountPublicKeys(): PublicKey[] {
  return BLOXROUTE_TIP_ACCOUNTS.map((a) => new PublicKey(a));
}

/** Returns the BloxRoute tip transfer instruction (add first in tx, before create ATA + buy). */
export function getBloxRouteTipInstruction(payer: PublicKey): TransactionInstruction {
  const tipAccount =
    BLOXROUTE_TIP_ACCOUNTS[Math.floor(Math.random() * BLOXROUTE_TIP_ACCOUNTS.length)];
  return SystemProgram.transfer({
    fromPubkey: payer,
    toPubkey: new PublicKey(tipAccount),
    lamports: BLOXROUTE_TIP_LAMPORTS,
  });
}

/** Result shape from BloxRoute submit-batch (each item may have signature, error, submitted). */
export interface BloxRouteBundleResult {
  confirmed: boolean;
  bundleHash?: string;
  result?: unknown;
  dropped?: boolean;
  signatures?: string[];
  simulationPassed?: boolean;
}

/**
 * Submit a bundle via BloxRoute Trader API submit-batch.
 * See: https://docs.bloxroute.com/solana/trader-api/api-endpoints/core-endpoints/submit-batch
 * useBundle: true requires the last transaction to include a Tip instruction.
 */
export async function sendBloxRouteBundle(
  transactions: VersionedTransaction[]
): Promise<BloxRouteBundleResult> {

  const baseUrl = BLOXROUTE_API_URL.replace(/\/$/, "");
  const headers = {
    "Content-Type": "application/json",
    Authorization: BLOXROUTE_AUTH_HEADER,
  };

  const entries = transactions.map((tx) => ({
    transaction: {
      content: Buffer.from(tx.serialize()).toString("base64"),
    },
    skipPreFlight: true, // important for bundles
  }));

  // 1️⃣ Submit bundle (longer timeout: BloxRoute may take time to validate/simulate)
  const { data } = await axios.post(
    `${baseUrl}/api/v2/submit-batch`,
    {
      entries,
      useBundle: true,
      frontRunningProtection: true,
    },
    { headers, timeout: 60000 }
  );

  const bundleHash = data?.bundleHash;

  if (!bundleHash) {
    console.error("No bundleHash returned:", data);
    return { confirmed: false };
  }

  // 2️⃣ Poll bundle result
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 1500));

    const result = await axios.post(
      `${baseUrl}/api/v2/bundle-result`,
      { bundleHash },
      { headers }
    );

    const status = result.data?.status;

    if (status === "Confirmed") {
      return {
        confirmed: true,
        bundleHash,
        result: result.data,
      };
    }

    if (status === "Failed") {
      console.error("Bundle failed:", JSON.stringify(result.data));
      return {
        confirmed: false,
        bundleHash,
        result: result.data,
      };
    }

    if (status === "Dropped") {
      return {
        confirmed: false,
        bundleHash,
        dropped: true,
      };
    }
  }

  return { confirmed: false, bundleHash };
}
