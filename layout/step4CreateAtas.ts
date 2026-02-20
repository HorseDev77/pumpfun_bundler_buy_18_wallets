import { loadMainWallet } from "../services/wallet";
import { loadBundlerKeypairs } from "../services/createWallets";
import { loadMintKeypair } from "../services/tokenMint";
import { createAtasForWallets } from "../services/ata";
import { getLookupTableAccount } from "../services/lookupTable";
import { readBundlerWallets, readLUTAddress, readLUTMint } from "../core/utils";
import { mainMenuWait } from "../core/utils";
import { init } from "../index";
import { connection } from "../config";
import { PublicKey } from "@solana/web3.js";

export async function step4CreateAtas() {
  console.log("=== Step 4: Create ATAs for token ===\n");
  console.log("(Run this only AFTER the token is created on-chain – e.g. after Step 5 full flow or after create token tx.)\n");
  const mintKp = loadMintKeypair();
  if (!mintKp) {
    console.log("Run Step 3 first to create mint keypair.");
    mainMenuWait(init);
    return;
  }
  // const mintInfo = await connection.getAccountInfo(mintKp.publicKey);
  // if (!mintInfo) {
  //   console.log("Mint account does not exist on-chain yet. Create the token first (Step 5 full flow), then run this step.");
  //   mainMenuWait(init);
  //   return;
  // }
  const wallets = readBundlerWallets("bundler");
  if (wallets.length === 0) {
    console.log("Run Step 2 first to create bundler wallets.");
    mainMenuWait(init);
    return;
  }
  const mainWallet = loadMainWallet();
  const keypairs = loadBundlerKeypairs(wallets);
  // const lutAddr = readLUTAddress();
  // const lutMint = readLUTMint();
  // const useLut = lutAddr && lutMint === mintKp.publicKey.toBase58();
  // const lookupTable = useLut ? await getLookupTableAccount(new PublicKey(lutAddr!)) : null;
   await createAtasForWallets(mintKp.publicKey, keypairs, mainWallet,  undefined);
  mainMenuWait(init);
}
