import { Keypair } from "@solana/web3.js";
import fs from "fs";
import path from "path";
import { TOKEN_NAME, TOKEN_SYMBOL, TOKEN_URI } from "../config";
import { ensureWalletsDir, readData, saveData } from "../core/utils";
import { TokenInfo } from "../core/types";

const MINT_KEYPAIR_DIR = "wallets";
const MINT_KEYPAIR_FILENAME = "mint-keypair.json";

export function createMintKeypair(): Keypair {
  ensureWalletsDir();
  const kp = Keypair.generate();
  const outPath = path.join(MINT_KEYPAIR_DIR, MINT_KEYPAIR_FILENAME);
  fs.writeFileSync(outPath, JSON.stringify(Array.from(kp.secretKey)), "utf-8");
  const data = readData<{ mintPublicKey?: string; created?: boolean }>();
  data.mintPublicKey = kp.publicKey.toBase58();
  data.created = false; // new keypair = token not created on-chain yet
  saveData(data);
  console.log("Mint keypair saved to", outPath, "| mint:", kp.publicKey.toBase58());
  return kp;
}

export function loadMintKeypair(): Keypair | null {
  const outPath = path.join(MINT_KEYPAIR_DIR, MINT_KEYPAIR_FILENAME);
  if (!fs.existsSync(outPath)) return null;
  try {
    const arr = JSON.parse(fs.readFileSync(outPath, "utf-8")) as number[];
    return Keypair.fromSecretKey(new Uint8Array(arr));
  } catch {
    return null;
  }
}

export function getTokenInfo(): TokenInfo {
  return {
    name: TOKEN_NAME,
    symbol: TOKEN_SYMBOL,
    uri: TOKEN_URI,
    decimals: 6,
  };
}

export function loadTokenInfoFromEnv(): TokenInfo {
  return getTokenInfo();
}
