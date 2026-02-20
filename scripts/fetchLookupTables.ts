/**
 * Fetch all transaction history of the main wallet, find created Address Lookup Table
 * accounts, and write their addresses to wallets/lookuptable.txt (one per line).
 *
 * Usage:
 *   npx ts-node scripts/fetchLookupTables.ts
 *
 * Requires CLUSTER, RPC URLs, and MAIN_WALLET_PRIVATE_KEY in .env.
 */

import dotenv from "dotenv";
dotenv.config();

import * as fs from "fs";
import * as path from "path";
import {
  Connection,
  PublicKey,
  AddressLookupTableProgram,
  VersionedMessage,
  MessageAccountKeys,
} from "@solana/web3.js";
import { connection } from "../config";
import { loadMainWallet } from "../services/wallet";

const LUT_PROGRAM_ID = AddressLookupTableProgram.programId;
/** CreateLookupTable instruction discriminator (u32 LE). */
const CREATE_LOOKUP_TABLE_INDEX = 0;

const OUTPUT_FILE = path.join(__dirname, "..", "wallets", "lookuptable.txt");
const MAX_SIGNATURES = 1000;
/** Delay (ms) between getTransaction calls. Use 1000+ for strict RPCs to avoid 429. Override with FETCH_LUT_DELAY_MS in .env. */
const REQUEST_DELAY_MS = parseInt(process.env.FETCH_LUT_DELAY_MS || "1200", 10);
const MAX_RETRIES = 5;
/** First backoff when 429 hit; then doubles each retry. Use 5000+ if RPC is strict. */
const INITIAL_BACKOFF_MS = parseInt(process.env.FETCH_LUT_BACKOFF_MS || "8000", 10);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function is429OrRateLimit(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("429") || /rate limit|too many requests/i.test(msg)) return true;
  const err = e as { code?: number; status?: number; data?: { httpStatus?: number } };
  return err?.code === 429 || err?.status === 429 || err?.data?.httpStatus === 429;
}

async function withRetry429<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt < MAX_RETRIES && is429OrRateLimit(e)) {
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
        console.warn(`  ${label}: rate limited (429), retry in ${backoff}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await sleep(backoff);
      } else {
        throw e;
      }
    }
  }
  throw lastErr;
}

function readInstructionType(data: Uint8Array): number {
  if (data.length < 4) return -1;
  return (data[0] | (data[1] << 8) | (data[2] << 16) | (data[3] << 24)) >>> 0;
}

async function main(): Promise<void> {
  const mainWallet = loadMainWallet();
  const address = mainWallet.publicKey;
  console.log("Main wallet:", address.toBase58());
  console.log("Fetching transaction history (max", MAX_SIGNATURES, "signatures)...");

  const allSigs = await withRetry429(
    () =>
      connection.getSignaturesForAddress(address, {
        limit: MAX_SIGNATURES,
      }),
    "getSignaturesForAddress"
  );
  console.log("Found", allSigs.length, "signatures.");
  console.log("Using delay", REQUEST_DELAY_MS, "ms between requests, backoff", INITIAL_BACKOFF_MS, "ms on 429.");
  await sleep(2000);

  const lutAddresses = new Set<string>();

  for (let i = 0; i < allSigs.length; i++) {
    const sig = allSigs[i].signature;
    if ((i + 1) % 50 === 0 || i === 0) {
      console.log("  Processing", i + 1, "/", allSigs.length);
    }
    if (i > 0) await sleep(REQUEST_DELAY_MS);
    try {
      const resp = await withRetry429(
        () =>
          connection.getTransaction(sig, {
            maxSupportedTransactionVersion: 0,
            commitment: "confirmed",
          }),
        `getTransaction(${i + 1})`
      );
      if (!resp?.transaction?.message) continue;

      const message = resp.transaction.message as VersionedMessage;
      let accountKeys: MessageAccountKeys;

      if (message.version === 0 && "addressTableLookups" in message && message.addressTableLookups?.length) {
        const lookupAccounts: (Awaited<ReturnType<typeof connection.getAddressLookupTable>>["value"])[] = [];
        for (const lookup of message.addressTableLookups) {
          await sleep(REQUEST_DELAY_MS);
          const result = await withRetry429(
            () => connection.getAddressLookupTable(lookup.accountKey),
            `getAddressLookupTable(${lookup.accountKey.toBase58().slice(0, 8)}...)`
          );
          lookupAccounts.push(result.value);
        }
        const valid = lookupAccounts.filter((a): a is NonNullable<typeof a> => a != null);
        if (valid.length !== message.addressTableLookups.length) continue;
        accountKeys = message.getAccountKeys({ addressLookupTableAccounts: valid });
      } else {
        accountKeys = message.getAccountKeys();
      }

      const compiledInstructions = message.compiledInstructions;

      for (const ix of compiledInstructions) {
        const programId = accountKeys.get(ix.programIdIndex);
        if (!programId?.equals(LUT_PROGRAM_ID)) continue;
        const data = ix.data;
        if (!data || data.length < 4) continue;
        const instructionType = readInstructionType(data);
        if (instructionType !== CREATE_LOOKUP_TABLE_INDEX) continue;
        const firstAccountIndex = ix.accountKeyIndexes[0];
        if (firstAccountIndex == null) continue;
        const lutPubkey = accountKeys.get(firstAccountIndex);
        if (lutPubkey) lutAddresses.add(lutPubkey.toBase58());
      }
    } catch (e) {
      // Skip failed txs (e.g. pruned, or LUT no longer loadable)
    }
  }

  const list = Array.from(lutAddresses);
  console.log("Found", list.length, "unique created lookup table(s).");
  const outPath = path.resolve(OUTPUT_FILE);
  fs.writeFileSync(outPath, list.join("\n") + (list.length ? "\n" : ""), "utf8");
  console.log("Written to", outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
