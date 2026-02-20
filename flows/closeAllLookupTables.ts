import fs from "fs";
import { PublicKey } from "@solana/web3.js";
import { checkMainWalletBalance } from "../services/wallet";
import {
  getLookupTableAccount,
  deactivateLookupTable,
  closeLookupTable,
} from "../services/lookupTable";
import { mainMenuWait, sleep } from "../core/utils";
import { init } from "../index";

const LUT_FILE = "wallets/lookuptable.txt";
const LAMPORTS_PER_SOL = 1e9;
/** ~rent-exempt size for an address lookup table account (metadata + addresses). */
const LUT_RENT_APPROX_LAMPORTS = 1_000_000;

/**
 * Read LUT addresses from wallets/lookuptable.txt (one base58 address per line),
 * then for each: deactivate if active, close if past cooldown; reclaim SOL to main wallet.
 */
export async function runCloseAllLookupTables() {
  console.log("=== Close all lookup tables (wallets/lookuptable.txt) & reclaim SOL ===\n");

  if (!fs.existsSync(LUT_FILE)) {
    console.error("File not found:", LUT_FILE);
    mainMenuWait(init);
    return;
  }

  const raw = fs.readFileSync(LUT_FILE, "utf-8");
  const lines = raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const addresses: PublicKey[] = [];
  for (const line of lines) {
    try {
      addresses.push(new PublicKey(line));
    } catch {
      console.warn("Invalid address skipped:", line);
    }
  }
  if (addresses.length === 0) {
    console.log("No valid LUT addresses in", LUT_FILE);
    mainMenuWait(init);
    return;
  }

  const { keypair: mainWallet } = await checkMainWalletBalance();
  const recipient = mainWallet.publicKey;

  let deactivated = 0;
  let closed = 0;
  let skipped = 0;
  let reclaimedLamports = 0;

  for (let i = 0; i < addresses.length; i++) {
    const lutAddress = addresses[i];
    const addrStr = lutAddress.toBase58();
    try {
      const lut = await getLookupTableAccount(lutAddress);
      if (!lut) {
        console.log(`[${i + 1}/${addresses.length}] ${addrStr} – account not found, skip`);
        skipped += 1;
        continue;
      }
      if (lut.isActive()) {
        console.log(`[${i + 1}/${addresses.length}] ${addrStr} – deactivating...`);
        await deactivateLookupTable(lutAddress, mainWallet);
        deactivated += 1;
        console.log("  Deactivated. Close after ~512 slots (run this again later).");
        await sleep(800);
        continue;
      }
      console.log(`[${i + 1}/${addresses.length}] ${addrStr} – closing (reclaim SOL)...`);
      await closeLookupTable(lutAddress, mainWallet, recipient);
      closed += 1;
      reclaimedLamports += LUT_RENT_APPROX_LAMPORTS;
      console.log("  Closed.");
      await sleep(600);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      if (msg.includes("AccountNotDeactivated") || msg.includes("deactivation") || msg.includes("cooldown")) {
        console.log(`[${i + 1}/${addresses.length}] ${addrStr} – not past cooldown yet, run again later.`);
        deactivated += 1; // we may have deactivated earlier
      } else {
        console.log(`[${i + 1}/${addresses.length}] ${addrStr} – error:`, msg);
        skipped += 1;
      }
    }
  }

  const reclaimedSol = reclaimedLamports / LAMPORTS_PER_SOL;
  console.log("\nDone. Deactivated:", deactivated, "| Closed:", closed, "| Skipped:", skipped);
  if (closed > 0) {
    console.log("Reclaimed ~", reclaimedSol.toFixed(6), "SOL to", recipient.toBase58());
  }
  mainMenuWait(init);
}
