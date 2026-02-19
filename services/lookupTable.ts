import {
  AddressLookupTableProgram,
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

import {
  bondingCurvePda,
  creatorVaultPda,
  GLOBAL_PDA,
  PUMP_EVENT_AUTHORITY_PDA,
  PUMP_PROGRAM_ID,
  PUMP_FEE_PROGRAM_ID,
} from "@pump-fun/pump-sdk";

import { connection } from "../config";
import { fetchGlobal } from "./pump";
import { sleep, waitForConfirmation } from "../core/utils";

const LUT_WAIT_MS = 20_000;
const EXTEND_BATCH_SIZE = 30;

/** Create lookup table and return its address. */
export async function createLookupTable(authority: Keypair): Promise<PublicKey> {
  const recentSlot = await connection.getSlot("finalized");

  const [createIx, lookupTableAddress] = AddressLookupTableProgram.createLookupTable({
    authority: authority.publicKey,
    payer: authority.publicKey,
    recentSlot,
  });

  const msg = new TransactionMessage({
    payerKey: authority.publicKey,
    recentBlockhash: (await connection.getLatestBlockhash("confirmed")).blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 50_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 500_000 }),
      createIx,
    ],
  }).compileToV0Message();

  const tx = new VersionedTransaction(msg);
  tx.sign([authority]);

  const sig = await connection.sendTransaction(tx, { skipPreflight: false });
  console.log("LUT create tx:", sig);

  await waitForConfirmation(sig);

  console.log("Waiting for LUT activation...");
  await sleep(LUT_WAIT_MS);

  return lookupTableAddress;
}

/** Extend lookup table with addresses (batched). */
export async function extendLookupTable(
  lookupTableAddress: PublicKey,
  authority: Keypair,
  addresses: PublicKey[]
): Promise<void> {
  for (let i = 0; i < addresses.length; i += EXTEND_BATCH_SIZE) {
    const slice = addresses.slice(i, i + EXTEND_BATCH_SIZE);

    const extendIx = AddressLookupTableProgram.extendLookupTable({
      payer: authority.publicKey,
      authority: authority.publicKey,
      lookupTable: lookupTableAddress,
      addresses: slice,
    });

    const msg = new TransactionMessage({
      payerKey: authority.publicKey,
      recentBlockhash: (await connection.getLatestBlockhash("confirmed")).blockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 50_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 500_000 }),
        extendIx,
      ],
    }).compileToV0Message();

    const tx = new VersionedTransaction(msg);
    tx.sign([authority]);

    const sig = await connection.sendTransaction(tx, { skipPreflight: false });
    console.log("LUT extend batch", Math.floor(i / EXTEND_BATCH_SIZE) + 1, "sig:", sig);

    await waitForConfirmation(sig);
    await sleep(2_000);
  }

  console.log("Waiting after LUT extend for slot finalization...");
  await sleep(LUT_WAIT_MS);
}

/** Collect ONLY addresses actually used in Pump.fun BUY. */
export async function collectLUTAddresses(
  mint: PublicKey,
  creator: PublicKey,
  bundlerWallets: PublicKey[]
): Promise<PublicKey[]> {
  const set = new Set<string>();
  const list: PublicKey[] = [];

  const add = (p: PublicKey) => {
    const k = p.toBase58();
    if (!set.has(k)) {
      set.add(k);
      list.push(p);
    }
  };

  const global = await fetchGlobal();

  // Core PDAs
  const bondingCurve = bondingCurvePda(mint);
  const bondingCurveAta = getAssociatedTokenAddressSync(mint, bondingCurve, true);
  const creatorVault = creatorVaultPda(creator);

  // Core program/state accounts
  add(mint);
  add(bondingCurve);
  add(bondingCurveAta);
  add(creatorVault);
  add(GLOBAL_PDA);
  add(PUMP_EVENT_AUTHORITY_PDA);
  add(global.feeRecipient);

  // Programs
  add(SystemProgram.programId);
  add(TOKEN_PROGRAM_ID);
  add(ASSOCIATED_TOKEN_PROGRAM_ID);
  add(PUMP_PROGRAM_ID);
  add(PUMP_FEE_PROGRAM_ID);

  // Buyer wallets + ATAs
  for (const wallet of bundlerWallets) {
    add(wallet);
    add(getAssociatedTokenAddressSync(mint, wallet));
  }

  return list;
}

/** Full helper: create LUT, extend with correct addresses, return address. */
export async function ensureLookupTable(
  mint: PublicKey,
  creator: PublicKey,
  authority: Keypair,
  bundlerKeypairs: Keypair[]
): Promise<PublicKey> {
  const bundlerPubkeys = bundlerKeypairs.map((k) => k.publicKey);

  const addresses = await collectLUTAddresses(mint, creator, bundlerPubkeys);

  console.log("Creating LUT...");
  const lutAddress = await createLookupTable(authority);

  console.log("Extending LUT with", addresses.length, "addresses...");
  await extendLookupTable(lutAddress, authority, addresses);

  return lutAddress;
}

/** Fetch lookup table account for compiling v0 transactions. */
export async function getLookupTableAccount(lookupTableAddress: PublicKey) {
  const result = await connection.getAddressLookupTable(lookupTableAddress);
  return result.value;
}

/** Debug helper: show which BUY instruction keys are NOT inside LUT. */
export function debugMissingLUTKeys(
  lut: import("@solana/web3.js").AddressLookupTableAccount,
  instruction: import("@solana/web3.js").TransactionInstruction
) {
  const lutSet = new Set(lut.state.addresses.map((a) => a.toBase58()));

  const missing = instruction.keys
    .map((k) => k.pubkey.toBase58())
    .filter((k) => !lutSet.has(k));

  console.log("Missing LUT keys:", missing.length);
  console.log(missing);
}