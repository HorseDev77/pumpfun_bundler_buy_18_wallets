import dotenv from "dotenv";

dotenv.config();

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v?.trim()) {
    console.error(`Missing required env: ${name}`);
    process.exit(1);
  }
  return v.trim();
}

function optionalEnv(name: string, defaultValue: string): string {
  return (process.env[name] ?? defaultValue).trim();
}

export const CLUSTER = requireEnv("CLUSTER").toLowerCase();
export const isDevnet = CLUSTER === "devnet";
export const isMainnet = CLUSTER === "mainnet";
export type Cluster = "devnet" | "mainnet";

if (!isDevnet && !isMainnet) {
  console.error("CLUSTER must be 'devnet' or 'mainnet'");
  process.exit(1);
}

export const MAINNET_RPC_URL = requireEnv("MAINNET_RPC_URL");
export const DEVNET_RPC_URL = requireEnv("DEVNET_RPC_URL");
export const MAINNET_WEBSOCKET_URL = optionalEnv("MAINNET_WEBSOCKET_URL", "");
export const DEVNET_WEBSOCKET_URL = optionalEnv("DEVNET_WEBSOCKET_URL", "");

export const RPC_URL = isMainnet ? MAINNET_RPC_URL : DEVNET_RPC_URL;
export const WS_URL = isMainnet ? MAINNET_WEBSOCKET_URL : DEVNET_WEBSOCKET_URL;

export const MAIN_WALLET_PRIVATE_KEY = requireEnv("MAIN_WALLET_PRIVATE_KEY");

export const BUNDLER_WALLET_COUNT = parseInt(optionalEnv("BUNDLER_WALLET_COUNT", "5"), 10);
/** Per-wallet: must cover max bundle buy (BUNDLE_BUY_SOL_MAX + 8% slippage) + rent. Default 0.03 ensures ~0.035 after rent buffer. */
export const SOL_DISTRIBUTE_MIN = parseFloat(optionalEnv("SOL_DISTRIBUTE_MIN", "0.03"));
export const SOL_DISTRIBUTE_MAX = parseFloat(optionalEnv("SOL_DISTRIBUTE_MAX", "0.06"));

export const TOKEN_NAME = optionalEnv("TOKEN_NAME", "MyToken");
export const TOKEN_SYMBOL = optionalEnv("TOKEN_SYMBOL", "MTK");
export const TOKEN_URI = optionalEnv("TOKEN_URI", "https://arweave.net/example");
/** Mint address for bundle-buy-only flow (existing token). Required when using [8] Bundle buy only. */
export const MINT_PUBLIC_KEY = optionalEnv("MINT_PUBLIC_KEY", "");

export const CREATOR_BUY_SOL = parseFloat(optionalEnv("CREATOR_BUY_SOL", "0.01"));
export const BUNDLE_BUY_SOL_MIN = parseFloat(optionalEnv("BUNDLE_BUY_SOL_MIN", "0.005"));
export const BUNDLE_BUY_SOL_MAX = parseFloat(optionalEnv("BUNDLE_BUY_SOL_MAX", "0.02"));

/** Bundle provider: "jito" | "bloxroute". Mainnet only; devnet sends txs in order. */
export const BUNDLE_PROVIDER = (optionalEnv("BUNDLE_PROVIDER", "jito").toLowerCase() === "bloxroute"
  ? "bloxroute"
  : "jito") as "jito" | "bloxroute";

export const JITO_FEE_LAMPORTS = parseInt(optionalEnv("JITO_FEE_LAMPORTS", "5000000"), 10);
export const JITO_BLOCK_ENGINE_URL = optionalEnv(
  "JITO_BLOCK_ENGINE_URL",
  "https://tokyo.mainnet.block-engine.jito.wtf/api/v1/bundles"
);
/** When true (mainnet), only simulate the bundle and do not send. */
export const JITO_SIMULATE_ONLY =
  process.env.JITO_SIMULATE_ONLY?.toLowerCase() === "true" || process.env.JITO_SIMULATE_ONLY === "1";

/** BloxRoute Trader API base URL (e.g. https://ny.solana.dex.blxrbdn.com). Required when BUNDLE_PROVIDER=bloxroute. */
export const BLOXROUTE_API_URL = optionalEnv("BLOXROUTE_API_URL", "");
/** BloxRoute Authorization header value. Required when BUNDLE_PROVIDER=bloxroute. */
export const BLOXROUTE_AUTH_HEADER = optionalEnv("BLOXROUTE_AUTH_HEADER", "");
/** BloxRoute tip per bundle (lamports). Min 1_000_000 (0.001 SOL). */
export const BLOXROUTE_TIP_LAMPORTS = parseInt(optionalEnv("BLOXROUTE_TIP_LAMPORTS", "1000000"), 10);