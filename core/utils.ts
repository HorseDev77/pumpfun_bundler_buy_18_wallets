import fs from "fs";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { connection } from "../config";

const WALLETS_DIR = "wallets";
const DATA_FILE = "data.json";

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Wait for tx by polling signature status. Avoids TransactionExpiredBlockheightExceededError. */
export async function waitForConfirmation(
  signature: string,
  opts?: { timeoutMs?: number; pollMs?: number }
): Promise<void> {
  const timeoutMs = opts?.timeoutMs ?? 90_000;
  const pollMs = opts?.pollMs ?? 2_000;
  const start = Date.now();
  let lastStatus: any = null;
  
  while (Date.now() - start < timeoutMs) {
    try {
      const statuses = await connection.getSignatureStatuses([signature]);
      const st = statuses.value[0];
      lastStatus = st;
      
      if (!st) {
        // Transaction not found yet, keep polling
        await sleep(pollMs);
        continue;
      }
      
      if (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized") {
        return; // Success!
      }
      
      if (st.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(st.err)}`);
      }
      
      // Still processing, wait and retry
      await sleep(pollMs);
    } catch (error: any) {
      // If it's a blockheight exceeded error, ignore it and keep polling
      // The transaction might still confirm later
      if (error?.name === "TransactionExpiredBlockheightExceededError" || 
          error?.message?.includes("block height exceeded")) {
        console.log(`Note: Blockheight exceeded for ${signature}, continuing to poll...`);
        await sleep(pollMs);
        continue;
      }
      throw error;
    }
  }
  
  throw new Error(
    `Confirmation timeout for ${signature}. Last status: ${JSON.stringify(lastStatus)}`
  );
}

export function randomInRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export async function getBalanceSol(pubkey: PublicKey): Promise<number> {
  const lamports = await connection.getBalance(pubkey, "confirmed");
  return lamports / LAMPORTS_PER_SOL;
}

export function ensureWalletsDir(): void {
  if (!fs.existsSync(WALLETS_DIR)) fs.mkdirSync(WALLETS_DIR, { recursive: true });
}

export function readBundlerWallets(filename: string = "bundler"): string[] {
  const path = `${WALLETS_DIR}/${filename}.json`;
  if (!fs.existsSync(path)) return [];
  try {
    const raw = fs.readFileSync(path, "utf-8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : data.wallets ?? [];
  } catch {
    return [];
  }
}

export function saveBundlerWallets(wallets: string[], filename: string = "bundler"): void {
  ensureWalletsDir();
  const path = `${WALLETS_DIR}/${filename}.json`;
  fs.writeFileSync(path, JSON.stringify(wallets, null, 2), "utf-8");
}

export function readData<T = Record<string, unknown>>(): T {
  if (!fs.existsSync(DATA_FILE)) return {} as T;
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")) as T;
  } catch {
    return {} as T;
  }
}

const LUT_ADDRESS_KEY = "lutAddress";
const LUT_MINT_KEY = "lutMintPublicKey";

export function readLUTAddress(): string | null {
  const data = readData<{ [LUT_ADDRESS_KEY]?: string }>();
  return data.lutAddress ?? null;
}

/** LUT is only valid for one mint (its addresses include that mint + ATAs for that mint). */
export function readLUTMint(): string | null {
  const data = readData<{ [LUT_MINT_KEY]?: string }>();
  return data.lutMintPublicKey ?? null;
}

export function saveLUTAddress(address: string, mintPublicKey?: string): void {
  const data = readData<Record<string, unknown>>();
  data[LUT_ADDRESS_KEY] = address;
  if (mintPublicKey != null) data[LUT_MINT_KEY] = mintPublicKey;
  saveData(data);
}

export function saveData(data: Record<string, unknown>): void {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
}

export function mainMenuWait(cb: () => void): void {
  const readline = require("readline");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question("Press Enter to continue...", () => {
    rl.close();
    cb();
  });
}
