import {
  PumpSdk,
  OnlinePumpSdk,
  getBuyTokenAmountFromSolAmount,
  bondingCurvePda,
  newBondingCurve,
  BONDING_CURVE_NEW_SIZE,
  PUMP_PROGRAM_ID,
} from "@pump-fun/pump-sdk";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { connection } from "../config";
import {
  CREATOR_BUY_SOL,
  BUNDLE_BUY_SOL_MIN,
  BUNDLE_BUY_SOL_MAX,
  TOKEN_NAME,
  TOKEN_SYMBOL,
  TOKEN_URI,
  isDevnet,
} from "../config";
import { randomInRange } from "../core/utils";

/** Fee recipients authorized by the Pump program (devnet may not use global.feeRecipient). */
const STATIC_FEE_RECIPIENTS = [
  "62qc2CNXwrYqQScmEdiZFFAnJR262PxWEuNQtxfafNgV",
  "7VtfL8fvgNfhz17qKRMjzQEXgbdpnHHHQRh54R9jP2RJ",
  "7hTckgnGnLQR6sdH7YkqFTAA7VwTfYFaZ6EhEsU3saCX",
  "9rPYyANsfQZw3DnDmKE3YCQF5E8oD89UXoHn9JFEhJUz",
  "AVmoTthdrX6tKt4nDjco2D775W2YK3sDhxPcMmzUAmTY",
  "CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM",
  "FWsW1xNtWscwNmKv6wVsU1iTzRN6wmmk3MjxRP5tT7hz",
  "G5UZAVbAf46s7cKWoyKu8kYTip9DGTpbLZ2qa9Aq69dP",
];

function getStaticFeeRecipient(): PublicKey {
  const i = Math.floor(Math.random() * STATIC_FEE_RECIPIENTS.length);
  return new PublicKey(STATIC_FEE_RECIPIENTS[i]);
}

/** Fee recipient from chain global; falls back to static list if global has none. */
export function getFeeRecipientFromGlobal(global: import("@pump-fun/pump-sdk").Global): PublicKey {
  const list = [
    global.feeRecipient,
    ...(global.feeRecipients ?? []),
  ].filter((p) => p && !p.equals(PublicKey.default));
  if (list.length === 0) return getStaticFeeRecipient();
  return list[Math.floor(Math.random() * list.length)];
}

const LAMPORTS_PER_SOL = 1e9;
/** Slippage for buy: allow program to use up to this much more SOL than nominal. Use 8% so 2nd+ buys in same tx (curve already moved) still pass. */
const SLIPPAGE_FRACTION = 0.08;

const sdk = new PumpSdk();
const onlineSdk = new OnlinePumpSdk(connection);

export async function fetchGlobal() {
  return onlineSdk.fetchGlobal();
}

/** Create token only (no buy). Creator gets ATA. Run this first, then create ATAs for bundler, then dev buy by bundler. */
export async function createTokenOnlyInstructions(
  mint: PublicKey,
  creator: PublicKey
): Promise<{ instructions: import("@solana/web3.js").TransactionInstruction[] }> {
  const createIx = await sdk.createInstruction({
    mint,
    name: TOKEN_NAME,
    symbol: TOKEN_SYMBOL,
    uri: TOKEN_URI,
    creator,
    user: creator,
  });
  const extendIx = await sdk.extendAccountInstruction({
    account: bondingCurvePda(mint),
    user: creator,
  });
  const associatedUser = getAssociatedTokenAddressSync(mint, creator, true);
  const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
    creator,
    associatedUser,
    creator,
    mint
  );
  return {
    instructions: [createIx, extendIx, createAtaIx],
  };
}

export async function createAndBuyInstructions(
  mint: PublicKey,
  creator: PublicKey,
  user: PublicKey,
  solAmountSol: number
): Promise<{ instructions: import("@solana/web3.js").TransactionInstruction[] }> {
  const global = await fetchGlobal();
  const solAmount = new BN(Math.floor(solAmountSol * LAMPORTS_PER_SOL));
  const amount = getBuyTokenAmountFromSolAmount({
    global,
    feeConfig: null,
    mintSupply: null,
    bondingCurve: null,
    amount: solAmount,
  });
  const instructions = await sdk.createAndBuyInstructions({
    global,
    mint,
    name: TOKEN_NAME,
    symbol: TOKEN_SYMBOL,
    uri: TOKEN_URI,
    creator,
    user,
    amount,
    solAmount,
  });
  return { instructions };
}

export async function buyInstructionsForUser(
  mint: PublicKey,
  user: PublicKey,
  solAmountSol: number
): Promise<{ instructions: import("@solana/web3.js").TransactionInstruction[] }> {
  const global = await fetchGlobal();
  const { bondingCurveAccountInfo, bondingCurve, associatedUserAccountInfo } =
    await onlineSdk.fetchBuyState(mint, user);
  const solAmount = new BN(Math.floor(solAmountSol * LAMPORTS_PER_SOL));
  const amount = getBuyTokenAmountFromSolAmount({
    global,
    feeConfig: null,
    mintSupply: bondingCurve.tokenTotalSupply,
    bondingCurve,
    amount: solAmount,
  });
  const instructions = await sdk.buyInstructions({
    global,
    bondingCurveAccountInfo,
    bondingCurve,
    associatedUserAccountInfo,
    mint,
    user,
    solAmount,
    amount,
    slippage: 2,
    tokenProgram: TOKEN_PROGRAM_ID,
  });
  return { instructions };
}

/**
 * Build buy instructions for a bundle where the token is created in tx 1.
 * Uses initial bonding curve state (no on-chain fetch) so we can build before the bundle is sent.
 * When ataAlreadyCreated is true (ATAs created in earlier bundle txs), returns only the buy instruction so multiple buys fit in one tx.
 */
export async function buyInstructionsForUserInBundle(
  mint: PublicKey,
  creator: PublicKey,
  user: PublicKey,
  solAmountSol: number,
  opts?: { ataAlreadyCreated?: boolean; feeRecipient?: PublicKey }
): Promise<{ instructions: import("@solana/web3.js").TransactionInstruction[] }> {
  const global = await fetchGlobal();
  const initialCurve = newBondingCurve(global);
  initialCurve.creator = creator;
  const solAmountLamports = new BN(Math.floor(solAmountSol * LAMPORTS_PER_SOL));
  const amount = getBuyTokenAmountFromSolAmount({
    global,
    feeConfig: null,
    mintSupply: global.tokenTotalSupply,
    bondingCurve: initialCurve,
    amount: solAmountLamports,
  });
  const solAmountWithSlippage = solAmountLamports.add(
    solAmountLamports.muln(Math.floor(SLIPPAGE_FRACTION * 1000)).divn(1000)
  );

  const feeRecipient = opts?.feeRecipient ?? getFeeRecipientFromGlobal(global);
  const buyIx = await sdk.getBuyInstructionRaw({
    user,
    mint,
    creator,
    amount,
    solAmount: solAmountWithSlippage,
    feeRecipient,
    tokenProgram: TOKEN_PROGRAM_ID,
  });

 

  if (opts?.ataAlreadyCreated) {
    return { instructions: [buyIx] };
  }

  if (isDevnet) {
    const associatedUser = getAssociatedTokenAddressSync(mint, user, true);
    // const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
    //   user,
    //   associatedUser,
    //   user,
    //   mint
    // );
    return { instructions: [ buyIx] };
  }

  const fakeBondingCurveAccountInfo: import("@solana/web3.js").AccountInfo<Buffer> = {
    data: Buffer.alloc(BONDING_CURVE_NEW_SIZE),
    executable: false,
    owner: PUMP_PROGRAM_ID,
    lamports: 0,
    rentEpoch: 0,
  };
  
  const instructions = await sdk.buyInstructions({
    global,
    bondingCurveAccountInfo: fakeBondingCurveAccountInfo,
    bondingCurve: initialCurve,
    associatedUserAccountInfo: null,
    mint,
    user,
    solAmount: solAmountWithSlippage,
    amount,
    slippage: 0,
    tokenProgram: TOKEN_PROGRAM_ID,
  });
  return { instructions };
}

export function randomBundleBuySol(): number {
  return randomInRange(BUNDLE_BUY_SOL_MIN, BUNDLE_BUY_SOL_MAX);
}
