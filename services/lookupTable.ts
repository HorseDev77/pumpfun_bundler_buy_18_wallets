import {
  AddressLookupTableProgram,
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";

import {
  bondingCurvePda,
  creatorVaultPda,
  GLOBAL_PDA,
  GLOBAL_VOLUME_ACCUMULATOR_PDA,
  PUMP_EVENT_AUTHORITY_PDA,
  PUMP_FEE_CONFIG_PDA,
  PUMP_PROGRAM_ID,
  PUMP_FEE_PROGRAM_ID,
  userVolumeAccumulatorPda,
  MAYHEM_PROGRAM_ID,
  getGlobalParamsPda,
  getMayhemStatePda,
  getSolVaultPda,
  getTokenVaultPda,
} from "@pump-fun/pump-sdk";

import { connection, isMainnet } from "../config";
import { getJitoTipAccountPublicKeys } from "./jito";
import { getBloxRouteTipAccountPublicKeys } from "./bloxroute";
import { fetchGlobal } from "./pump";
import { sleep, waitForConfirmation } from "../core/utils";

const LUT_WAIT_MS = 20_000;

/** Metaplex Token Metadata program (create instruction). */
const MPL_TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

/** Pump create: mint authority PDA (seeds "mint-authority"). */
function pumpMintAuthorityPda(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("mint-authority")],
    PUMP_PROGRAM_ID
  )[0];
}

/** Metaplex metadata PDA for a mint (create instruction). */
function metaplexMetadataPda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      MPL_TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
    MPL_TOKEN_METADATA_PROGRAM_ID
  )[0];
}
const EXTEND_BATCH_SIZE = 20;

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

  // This project uses Token-2022 for all Pump tokens (create, ATAs, buy).
  // LUT must include all accounts used by: create, extendAccount, create-ATA (Token-22), buy (SDK getBuyInstructionRaw).
  const tokenProgram = TOKEN_2022_PROGRAM_ID;

  // Payer/creator (used by create-token and create-ATA txs)
  add(creator);

  // Core PDAs
  const bondingCurve = bondingCurvePda(mint);
  const bondingCurveAta = getAssociatedTokenAddressSync(mint, bondingCurve, true, tokenProgram);
  const creatorVault = creatorVaultPda(creator);

  // Core program/state accounts
  add(mint);
  add(bondingCurve);
  add(bondingCurveAta);
  add(creatorVault);
  add(GLOBAL_PDA);
  add(PUMP_EVENT_AUTHORITY_PDA);
  add(global.feeRecipient);

  // Create instruction (mainnet): mint authority, Metaplex metadata, rent
  add(pumpMintAuthorityPda());
  add(MPL_TOKEN_METADATA_PROGRAM_ID);
  add(metaplexMetadataPda(mint));
  add(SYSVAR_RENT_PUBKEY);
  // Create-v2 (Token-2022) mayhem accounts
  add(MAYHEM_PROGRAM_ID);
  add(getGlobalParamsPda());
  add(getSolVaultPda());
  add(getMayhemStatePda(mint));
  add(getTokenVaultPda(mint));

  // Programs
  add(SystemProgram.programId);
  add(TOKEN_2022_PROGRAM_ID);
  add(ASSOCIATED_TOKEN_PROGRAM_ID);
  add(PUMP_PROGRAM_ID);
  add(PUMP_FEE_PROGRAM_ID);

  // Buyer wallets + ATAs (allowOwnerOffCurve: true, tokenProgram to match ata.ts / Pump)
  for (const wallet of bundlerWallets) {
    add(wallet);
    add(getAssociatedTokenAddressSync(mint, wallet, true, tokenProgram));
    add(userVolumeAccumulatorPda(wallet));
  }

  // Pump buy instruction: global volume accumulator + fee config
  add(GLOBAL_VOLUME_ACCUMULATOR_PDA);
  add(PUMP_FEE_CONFIG_PDA);

  // Jito tip accounts (mainnet: first tx includes tip instruction)
  if (isMainnet) {
    // for (const tipAccount of getJitoTipAccountPublicKeys()) {
    //   add(tipAccount);
    // }
    for (const tipAccount of getBloxRouteTipAccountPublicKeys()) {
      add(tipAccount);
    }
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

/** Deactivate LUT so it can be closed after cooldown (~512 slots). Authority must sign. */
export async function deactivateLookupTable(
  lookupTableAddress: PublicKey,
  authority: Keypair
): Promise<string> {
  const extendIx = AddressLookupTableProgram.deactivateLookupTable({
    lookupTable: lookupTableAddress,
    authority: authority.publicKey,
  });
  const msg = new TransactionMessage({
    payerKey: authority.publicKey,
    recentBlockhash: (await connection.getLatestBlockhash("confirmed")).blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 50_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
      extendIx,
    ],
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign([authority]);
  const sig = await connection.sendTransaction(tx, { skipPreflight: false });
  await waitForConfirmation(sig);
  return sig;
}

/** Close LUT and reclaim rent to recipient. LUT must be deactivated and past cooldown (~512 slots). */
export async function closeLookupTable(
  lookupTableAddress: PublicKey,
  authority: Keypair,
  recipient: PublicKey
): Promise<string> {
  const closeIx = AddressLookupTableProgram.closeLookupTable({
    lookupTable: lookupTableAddress,
    authority: authority.publicKey,
    recipient,
  });
  const msg = new TransactionMessage({
    payerKey: authority.publicKey,
    recentBlockhash: (await connection.getLatestBlockhash("confirmed")).blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 50_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
      closeIx,
    ],
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign([authority]);
  const sig = await connection.sendTransaction(tx, { skipPreflight: false });
  await waitForConfirmation(sig);
  return sig;
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