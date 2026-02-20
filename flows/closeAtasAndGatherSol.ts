import { PublicKey } from "@solana/web3.js";
import { checkMainWalletBalance } from "../services/wallet";
import { loadBundlerKeypairs } from "../services/createWallets";
import { readBundlerWallets, readData } from "../core/utils";
import { closeMainWalletAtas } from "../services/closeAtas";
import { gatherSolToMain } from "../services/gatherSol";
import { deactivateLookupTable, getLookupTableAccount } from "../services/lookupTable";
import { mainMenuWait } from "../core/utils";
import { init } from "../index";
import { BUNDLER_WALLET_COUNT } from "../config";

/**
 * Close all zero-balance ATAs (and reclaim rent) for the main wallet,
 * deactivate LUT from data.json if present (so it can be closed after cooldown),
 * then gather SOL from bundler wallets to the main wallet.
 */
export async function runCloseAtasAndGatherSol() {
  console.log("=== Close main wallet ATAs & gather SOL ===\n");

  const { keypair: mainWallet } = await checkMainWalletBalance();

  console.log("\n1) Closing zero-balance token accounts (rent → main wallet)...");
  const closeResult = await closeMainWalletAtas(mainWallet, mainWallet.publicKey);
  if (closeResult.closedCount > 0) {
    console.log(
      "Closed",
      closeResult.closedCount,
      "ATAs, reclaimed ~",
      closeResult.reclaimedSol.toFixed(6),
      "SOL in",
      closeResult.txCount,
      "tx(s)."
    );
  }

  const data = readData<{ lutAddress?: string }>();
  if (data.lutAddress) {
    try {
      const lut = await getLookupTableAccount(new PublicKey(data.lutAddress));
      if (lut && lut.isActive()) {
        console.log("\n1b) Deactivating lookup table (can close after ~512 slots)...");
        const sig = await deactivateLookupTable(new PublicKey(data.lutAddress), mainWallet);
        console.log("LUT deactivate tx:", sig);
      }
    } catch (e) {
      console.log("LUT deactivate skipped:", (e as Error).message);
    }
  }

  const bundlerWallets = readBundlerWallets("bundler");
  if (bundlerWallets.length === 0) {
    console.log("\nNo bundler wallets. Skip gather.");
    mainMenuWait(init);
    return;
  }

  const bundlerKeypairs = loadBundlerKeypairs(bundlerWallets).slice(0, BUNDLER_WALLET_COUNT);
  console.log("\n2) Gathering SOL from", bundlerKeypairs.length, "bundler wallets...");
  const { gatheredSol, txCount } = await gatherSolToMain(mainWallet, bundlerKeypairs);
  console.log("Gathered", gatheredSol.toFixed(6), "SOL in", txCount, "tx(s).");

  console.log("\nDone.");
  mainMenuWait(init);
}
