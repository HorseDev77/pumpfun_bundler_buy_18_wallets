/**
 * Test script: bonding curve derivation and on-chain checks for a Pump.fun mint.
 *
 * Usage:
 *   npx ts-node scripts/test-bonding-curve.ts [MINT_ADDRESS]
 *
 * If MINT_ADDRESS is omitted, uses MINT_PUBLIC_KEY from .env.
 * Set CLUSTER and RPC URLs in .env for on-chain checks.
 */

import dotenv from "dotenv";
dotenv.config();

import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { bondingCurvePda } from "@pump-fun/pump-sdk";

const EXPECTED_CURVE = "BRctqtFx8kpk5CKBKmTR6LkW725bUn7V6R49RuRoFWbL";

function main() {
  const mintArg = process.argv[2] ?? process.env.MINT_PUBLIC_KEY;
  if (!mintArg?.trim()) {
    console.log("Usage: npx ts-node scripts/test-bonding-curve.ts [MINT_ADDRESS]");
    console.log("  Or set MINT_PUBLIC_KEY in .env");
    process.exit(1);
  }

  let mint: PublicKey;
  try {
    mint = new PublicKey(mintArg.trim());
  } catch (e) {
    console.error("Invalid mint address:", mintArg);
    process.exit(1);
  }

  console.log("Mint:", mint.toBase58());
  console.log("");

  // 1) Derived bonding curve (no RPC)
  const derivedCurve = bondingCurvePda(mint);
  console.log("1) Derived bonding curve (SDK PDA):");
  console.log("   ", derivedCurve.toBase58());
  console.log("   Expected (your value):", EXPECTED_CURVE);
  console.log("   Match:", derivedCurve.toBase58() === EXPECTED_CURVE);
  console.log("");

  // 2) Derived curve ATA for Token-2022 and Token (so we know which to use)
  const curveAtaToken2022 = getAssociatedTokenAddressSync(mint, derivedCurve, true, TOKEN_2022_PROGRAM_ID);
  const curveAtaToken = getAssociatedTokenAddressSync(mint, derivedCurve, true, TOKEN_PROGRAM_ID);
  console.log("2) Associated bonding curve token account (curve holds supply):");
  console.log("   Token-2022:", curveAtaToken2022.toBase58());
  console.log("   Token (legacy):", curveAtaToken.toBase58());
  console.log("");

  // 3) On-chain checks (optional; requires RPC)
  const rpc = process.env[process.env.CLUSTER === "mainnet" ? "MAINNET_RPC_URL" : "DEVNET_RPC_URL"];
  if (!rpc?.trim()) {
    console.log("3) On-chain: skipped (no RPC in .env for current CLUSTER)");
    return;
  }

  const connection = new Connection(rpc, "confirmed");

  connection
    .getMultipleAccountsInfo([mint, derivedCurve, curveAtaToken2022, curveAtaToken])
    .then(([mintInfo, curveInfo, curveAta2022Info, curveAtaTokenInfo]) => {
      console.log("3) On-chain:");
      if (!mintInfo) {
        console.log("   Mint account: NOT FOUND");
      } else {
        const owner = mintInfo.owner.toBase58();
        const isToken22 = owner === TOKEN_2022_PROGRAM_ID.toBase58();
        console.log("   Mint account: exists");
        console.log("   Mint owner (token program):", owner, isToken22 ? "(Token-2022)" : "(Token legacy)");
      }

      if (!curveInfo) {
        console.log("   Bonding curve account: NOT FOUND (token may be graduated or wrong cluster)");
      } else {
        console.log("   Bonding curve account: exists, data length", curveInfo.data.length);
      }

      const curveAtaInfo = mintInfo?.owner.equals(TOKEN_2022_PROGRAM_ID) ? curveAta2022Info : curveAtaTokenInfo;
      if (!curveAtaInfo) {
        console.log("   Curve ATA (for mint's token program): NOT FOUND → Buy will fail with AccountNotInitialized");
      } else {
        console.log("   Curve ATA (for mint's token program): exists");
      }
    })
    .catch((e: Error) => console.log("3) On-chain error:", e.message));
}

main();
