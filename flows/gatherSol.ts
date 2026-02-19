import { checkMainWalletBalance } from "../services/wallet";
import { loadBundlerKeypairs } from "../services/createWallets";
import { readBundlerWallets } from "../core/utils";
import { gatherSolToMain } from "../services/gatherSol";
import { mainMenuWait } from "../core/utils";
import { init } from "../index";
import { BUNDLER_WALLET_COUNT } from "../config";

export async function runGatherSol() {
  console.log("=== Gather SOL from bundler wallets ===\n");

  const { keypair: mainWallet } = await checkMainWalletBalance();
  const bundlerWallets = readBundlerWallets("bundler");
  if (bundlerWallets.length === 0) {
    console.log("No bundler wallets found. Create wallets first (Step 2).");
    mainMenuWait(init);
    return;
  }

  const bundlerKeypairs = loadBundlerKeypairs(bundlerWallets).slice(0, BUNDLER_WALLET_COUNT);
  console.log("Bundler wallets:", bundlerKeypairs.length);

  const { gatheredSol, txCount } = await gatherSolToMain(mainWallet, bundlerKeypairs);
  console.log(`Gathered ${gatheredSol.toFixed(6)} SOL in ${txCount} tx(s).`);
  mainMenuWait(init);
}
