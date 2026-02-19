# Pump.fun Bundler

Pump.fun token launch bundler using [@pump-fun/pump-sdk](https://www.npmjs.com/package/@pump-fun/pump-sdk). Flow: load wallet → check balance → create bundler wallets → distribute SOL (random range from .env) → create mint keypair & token info → create ATAs → create token + dev buy → bundle buy (Jito on mainnet, sequential on devnet).

## Structure

- **config/** – env and connection (devnet/mainnet from `.env`)
- **core/** – types, utils, persistence (wallets, data.json)
- **services/** – wallet, createWallets, distributeSol, tokenMint, ata, pump, jito, lookupTable
- **layout/** – menu steps (load wallet, create wallets, mint keypair, create ATAs)
- **flows/** – full flow: create token + dev buy + Jito bundle buy
- **menu/** – CLI menu

## Setup

1. Copy `.env.example` to `.env`.
2. Set `CLUSTER=devnet` or `mainnet`, RPC URLs, `MAIN_WALLET_PRIVATE_KEY` (base58), and optional `SOL_DISTRIBUTE_MIN` / `SOL_DISTRIBUTE_MAX`, `BUNDLER_WALLET_COUNT`, token name/symbol/uri, buy amounts, Jito settings.
3. `npm install` then `npm start`.

## Menu

1. Load wallet & check balance  
2. Create wallets & distribute SOL (random SOL per wallet between `SOL_DISTRIBUTE_MIN` and `SOL_DISTRIBUTE_MAX`)  
3. Create mint keypair & load token info (from .env)  
4. Create ATAs for token (run after token exists)  
5. Full flow: create token → LUT → create ATAs → dev buy by bundler (Jito on mainnet). Create ATA and dev buy txs use an **address lookup table** to reduce size.  
6. Exit  

## Env (see .env.example)

- `CLUSTER` – `devnet` | `mainnet`
- `MAINNET_RPC_URL` / `DEVNET_RPC_URL` – RPC URLs
- `MAIN_WALLET_PRIVATE_KEY` – base58 main wallet
- `BUNDLER_WALLET_COUNT` – number of bundler wallets (default 10)
- `SOL_DISTRIBUTE_MIN` / `SOL_DISTRIBUTE_MAX` – random SOL per wallet (in SOL)
- `TOKEN_NAME` / `TOKEN_SYMBOL` / `TOKEN_URI` – token metadata
- `CREATOR_BUY_SOL` – initial buy when creating token
- `BUNDLE_BUY_SOL_MIN` / `BUNDLE_BUY_SOL_MAX` – random buy size per bundler (in SOL)
- `JITO_FEE_LAMPORTS` / `JITO_BLOCK_ENGINE_URL` – for mainnet Jito bundles
