import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { BUNDLER_WALLET_COUNT } from "../config";
import { saveBundlerWallets } from "../core/utils";

export function createBundlerWallets(): Keypair[] {
  const keypairs: Keypair[] = [];
  const encoded: string[] = [];
  for (let i = 0; i < BUNDLER_WALLET_COUNT; i++) {
    const kp = Keypair.generate();
    keypairs.push(kp);
    encoded.push(bs58.encode(kp.secretKey));
  }
  saveBundlerWallets(encoded);
  console.log(`Created ${keypairs.length} bundler wallets.`);
  return keypairs;
}

export function loadBundlerKeypairs(encodedWallets: string[]): Keypair[] {
  return encodedWallets.map((w) => Keypair.fromSecretKey(bs58.decode(w)));
}
