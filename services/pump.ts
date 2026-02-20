import {
  PumpSdk,
  OnlinePumpSdk,
  getBuyTokenAmountFromSolAmount,
  bondingCurvePda,
  BONDING_CURVE_NEW_SIZE,
  PUMP_PROGRAM_ID,
} from "@pump-fun/pump-sdk";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
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
} from "../config";
import { randomInRange } from "../core/utils";

/** Fee recipients authorized by the Pump program (devnet / fallback). */
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

/** Fetch bonding curve for an existing token and return the creator pubkey (for bundle-buy-only flow). */
export async function fetchBondingCurveCreator(mint: PublicKey): Promise<PublicKey> {
  const bondingCurve = await onlineSdk.fetchBondingCurve(mint);
  return bondingCurve.creator;
}

/** Resolve token program from mint account (mint.owner). Required so buy uses correct associated_bonding_curve PDA. */
export async function getTokenProgramForMint(mint: PublicKey): Promise<PublicKey> {
  const info = await connection.getAccountInfo(mint);
  if (!info) throw new Error("Mint account not found");
  return info.owner;
}

/** Create token only (no buy). Creator gets ATA. Run this first, then create ATAs for bundler, then dev buy by bundler. */
export async function createTokenOnlyInstructions(
  mint: PublicKey,
  creator: PublicKey
): Promise<{ instructions: import("@solana/web3.js").TransactionInstruction[] }> {
  const createIx = await sdk.createV2Instruction({
    mint,
    name: TOKEN_NAME,
    symbol: TOKEN_SYMBOL,
    uri: TOKEN_URI,
    creator,
    user: creator,
    mayhemMode: false,
    cashback: false,
  });
  const extendIx = await sdk.extendAccountInstruction({
    account: bondingCurvePda(mint),
    user: creator,
  });
  const associatedUser = getAssociatedTokenAddressSync(mint, creator, true, TOKEN_2022_PROGRAM_ID);
  const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
    creator,
    associatedUser,
    creator,
    mint,
    TOKEN_2022_PROGRAM_ID
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
  const instructions = await sdk.createV2AndBuyInstructions({
    global,
    mint,
    name: TOKEN_NAME,
    symbol: TOKEN_SYMBOL,
    uri: TOKEN_URI,
    creator,
    user,
    amount,
    solAmount,
    mayhemMode: false,
    cashback: false,
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
    tokenProgram: TOKEN_2022_PROGRAM_ID,
  });
  return { instructions };
}

/**
 * Build buy instructions for bundle (Token-2022 or legacy from mint.owner).
 * Uses sdk.buyInstructions() so tokenProgram is passed through to associated_bonding_curve.
 * When ataAlreadyCreated is true, only the buy instruction is returned (no create ATA).
 * Fetches global and the token's bonding curve from chain so fee recipient matches the
 * program (getFeeRecipient(global, bondingCurve.isMayhemMode)).
 */
export async function buyInstructionsForUserInBundle(
  mint: PublicKey,
  _creator: PublicKey,
  user: PublicKey,
  solAmountSol: number,
  opts?: { ataAlreadyCreated?: boolean; feeRecipient?: PublicKey; tokenProgram?: PublicKey }
): Promise<{ instructions: import("@solana/web3.js").TransactionInstruction[] }> {
  const tokenProgram = opts?.tokenProgram ?? (await getTokenProgramForMint(mint));
  const [global, curveAccountInfo] = await Promise.all([
    fetchGlobal(),
    connection.getAccountInfo(bondingCurvePda(mint)),
  ]);
  if (!curveAccountInfo) {
    throw new Error(`Bonding curve not found for mint: ${mint.toBase58()}`);
  }
  const bondingCurve = sdk.decodeBondingCurve(curveAccountInfo);

  const solAmountLamports = new BN(Math.floor(solAmountSol * LAMPORTS_PER_SOL));
  const amount = getBuyTokenAmountFromSolAmount({
    global,
    feeConfig: null,
    mintSupply: bondingCurve.tokenTotalSupply,
    bondingCurve,
    amount: solAmountLamports,
  });
  const solAmountWithSlippage = solAmountLamports.add(
    solAmountLamports.muln(Math.floor(SLIPPAGE_FRACTION * 1000)).divn(1000)
  );

  const associatedUserAccountInfo =
    opts?.ataAlreadyCreated
      ? ({ data: Buffer.alloc(1), executable: false, owner: tokenProgram, lamports: 0, rentEpoch: 0 } as import("@solana/web3.js").AccountInfo<Buffer>)
      : null;

  const instructions = await sdk.buyInstructions({
    global,
    bondingCurveAccountInfo: curveAccountInfo,
    bondingCurve,
    associatedUserAccountInfo,
    mint,
    user,
    solAmount: solAmountWithSlippage,
    amount,
    slippage: 0,
    tokenProgram,
  });
  return { instructions };
}

export function randomBundleBuySol(): number {
  return randomInRange(BUNDLE_BUY_SOL_MIN, BUNDLE_BUY_SOL_MAX);
}
