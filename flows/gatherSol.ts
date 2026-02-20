import { checkMainWalletBalance } from "../services/wallet";
import { loadBundlerKeypairs } from "../services/createWallets";
import { readBundlerWallets } from "../core/utils";
import { gatherSolToMain } from "../services/gatherSol";
import { mainMenuWait } from "../core/utils";
import { init } from "../index";

export async function runGatherSol() {
  console.log("=== Gather SOL from all bundler wallets (bundler.json) ===\n");

  const { keypair: mainWallet } = await checkMainWalletBalance();
  const bundlerWallets = readBundlerWallets("bundler");
  if (bundlerWallets.length === 0) {
    console.log("No bundler wallets found. Create wallets first (Step 2).");
    mainMenuWait(init);
    return;
  }

  const bundlerKeypairs = loadBundlerKeypairs(bundlerWallets);
  console.log("Bundler wallets (all in bundler.json):", bundlerKeypairs.length);

  const { gatheredSol, txCount } = await gatherSolToMain(mainWallet, bundlerKeypairs);
  console.log(`Gathered ${gatheredSol.toFixed(6)} SOL in ${txCount} tx(s).`);
  mainMenuWait(init);
}
