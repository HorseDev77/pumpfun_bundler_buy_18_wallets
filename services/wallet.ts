import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { MAIN_WALLET_PRIVATE_KEY } from "../config";
import { getBalanceSol } from "../core/utils";

export function loadMainWallet(): Keypair {
  const secret = bs58.decode(MAIN_WALLET_PRIVATE_KEY);
  return Keypair.fromSecretKey(new Uint8Array(secret));
}

export async function checkMainWalletBalance(): Promise<{ keypair: Keypair; balanceSol: number }> {
  const keypair = loadMainWallet();
  const balanceSol = await getBalanceSol(keypair.publicKey);
  console.log("Main wallet:", keypair.publicKey.toBase58());
  console.log("Balance:", balanceSol.toFixed(6), "SOL");
  return { keypair, balanceSol };
}
