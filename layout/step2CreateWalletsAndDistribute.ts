import { loadMainWallet } from "../services/wallet";
import { createBundlerWallets, loadBundlerKeypairs } from "../services/createWallets";
import { distributeSolToWallets } from "../services/distributeSol";
import { readBundlerWallets } from "../core/utils";
import { mainMenuWait } from "../core/utils";
import { init } from "../index";
import { BUNDLER_WALLET_COUNT } from "../config";

export async function step2CreateWalletsAndDistribute() {
  console.log("=== Step 2: Create wallets & distribute SOL ===\n");
  const mainWallet = loadMainWallet();
  let wallets = readBundlerWallets("bundler");
  if (wallets.length === 0) {
    createBundlerWallets();
    wallets = readBundlerWallets("bundler");
  }
  const keypairs = loadBundlerKeypairs(wallets).slice(0, BUNDLER_WALLET_COUNT);
  console.log("Bundler wallets:", keypairs.length);
  //await distributeSolToWallets(mainWallet, keypairs);
  mainMenuWait(init);
}
