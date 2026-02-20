import { Keypair } from "@solana/web3.js";
import fs from "fs";
import path from "path";
import { TOKEN_NAME, TOKEN_SYMBOL, TOKEN_URI } from "../config";
import { ensureWalletsDir, readData, saveData } from "../core/utils";
import { TokenInfo } from "../core/types";

const MINT_KEYPAIR_DIR = "wallets";
const MINT_KEYPAIR_FILENAME = "mint-keypair.json";
const METAPLEX_NAME_MAX = 32;
const METAPLEX_SYMBOL_MAX = 10;
const METAPLEX_URI_MAX = 200;

function validateTokenMetadataOrThrow(name: string, symbol: string, uri: string): void {
  if (name.length === 0) throw new Error("TOKEN_NAME is empty");
  if (symbol.length === 0) throw new Error("TOKEN_SYMBOL is empty");
  if (uri.length === 0) throw new Error("TOKEN_URI is empty");

  if (name.length > METAPLEX_NAME_MAX) {
    throw new Error(`TOKEN_NAME too long (${name.length}/${METAPLEX_NAME_MAX}).`);
  }
  if (symbol.length > METAPLEX_SYMBOL_MAX) {
    throw new Error(`TOKEN_SYMBOL too long (${symbol.length}/${METAPLEX_SYMBOL_MAX}).`);
  }
  if (uri.length > METAPLEX_URI_MAX) {
    throw new Error(`TOKEN_URI too long (${uri.length}/${METAPLEX_URI_MAX}).`);
  }
}

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
  validateTokenMetadataOrThrow(TOKEN_NAME, TOKEN_SYMBOL, TOKEN_URI);

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
