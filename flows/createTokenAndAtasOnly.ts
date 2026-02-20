/**
 * Create 15 ATAs in one tx for an existing token.
 * Mint is read from .env (MINT_PUBLIC_KEY). Assumes 20 wallets: 5 already have ATAs, 15 get new ATAs.
 */

import { ComputeBudgetProgram, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { checkMainWalletBalance } from "../services/wallet";
import {
  createBundlerWallets,
  loadBundlerKeypairs,
} from "../services/createWallets";
import {
  ensureLookupTable,
  getLookupTableAccount,
} from "../services/lookupTable";
import { getTokenProgramForMint } from "../services/pump";
import { buildCreateAtaIdempotentInstructionsForOwners } from "../services/ata";
import {
  readBundlerWallets,
  readData,
  mainMenuWait,
  saveData,
  waitForConfirmation,
} from "../core/utils";
import { connection } from "../config";
import { MINT_PUBLIC_KEY } from "../config";
import { init } from "../index";

const TOTAL_WALLETS = 20;
const NUM_EXISTING_ATA = 5;
const NUM_NEW_ATA = TOTAL_WALLETS - NUM_EXISTING_ATA; // 15
const COMPUTE_UNIT_LIMIT = 500_000;
const COMPUTE_UNIT_PRICE = 100_000;

export async function runCreateTokenAndAtasOnly() {
  console.log("=== Create 15 ATAs (one tx; mint from .env) ===\n");

  if (!MINT_PUBLIC_KEY?.trim()) {
    console.error("Set MINT_PUBLIC_KEY in .env to an existing token mint address.");
    mainMenuWait(init);
    return;
  }

  const mint = new PublicKey(MINT_PUBLIC_KEY.trim());
  let tokenProgram: PublicKey;
  try {
    tokenProgram = await getTokenProgramForMint(mint);
    console.log("Mint:", mint.toBase58(), "| token program:", tokenProgram.toBase58());
  } catch (e) {
    console.error("Invalid mint: mint account not found on-chain. Set MINT_PUBLIC_KEY in .env to an existing token mint.");
    mainMenuWait(init);
    return;
  }

  const { keypair: mainWallet } = await checkMainWalletBalance();

  let bundlerWallets = readBundlerWallets("bundler");
  if (bundlerWallets.length === 0) {
    createBundlerWallets();
    bundlerWallets = readBundlerWallets("bundler");
  }
  const bundlerKeypairs = loadBundlerKeypairs(bundlerWallets).slice(0, TOTAL_WALLETS);

  if (bundlerKeypairs.length < TOTAL_WALLETS) {
    console.error(
      `Need at least ${TOTAL_WALLETS} bundler wallets, have ${bundlerKeypairs.length}. Set BUNDLER_WALLET_COUNT >= ${TOTAL_WALLETS}.`
    );
    mainMenuWait(init);
    return;
  }

  const data = readData<{ mintPublicKey?: string; lutAddress?: string }>();
  const currentMint = mint.toBase58();
  let lutAddress: string;

  if (data.lutAddress && data.mintPublicKey === currentMint) {
    const existing = await getLookupTableAccount(new PublicKey(data.lutAddress));
    if (existing) {
      console.log("Using existing LUT:", data.lutAddress);
      lutAddress = data.lutAddress;
    } else {
      lutAddress = (
        await ensureLookupTable(mint, mainWallet.publicKey, mainWallet, bundlerKeypairs)
      ).toBase58();
      data.lutAddress = lutAddress;
      data.mintPublicKey = currentMint;
      saveData(data);
    }
  } else {
    console.log("Creating lookup table...");
    lutAddress = (
      await ensureLookupTable(mint, mainWallet.publicKey, mainWallet, bundlerKeypairs)
    ).toBase58();
    data.lutAddress = lutAddress;
    data.mintPublicKey = currentMint;
    saveData(data);
  }

  const lookupTable = await getLookupTableAccount(new PublicKey(lutAddress));
  if (!lookupTable) {
    console.error("LUT verification failed. Abort.");
    mainMenuWait(init);
    return;
  }

  const ownersForNewAtas = bundlerKeypairs.slice(NUM_EXISTING_ATA, TOTAL_WALLETS).map((k) => k.publicKey);
  const createAtaIxs = buildCreateAtaIdempotentInstructionsForOwners(
    mint,
    ownersForNewAtas,
    mainWallet.publicKey,
    tokenProgram
  );

  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const instructions = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_LIMIT }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: COMPUTE_UNIT_PRICE }),
    ...createAtaIxs,
  ];

  const msg = new TransactionMessage({
    payerKey: mainWallet.publicKey,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message([lookupTable]);
  const tx = new VersionedTransaction(msg);
  // Only signers required by the message: create-ATA-only tx needs only payer (mainWallet).
  // If this tx included create token, we would also sign with mintKeypair.
  tx.sign([mainWallet]);
  console.log("Tx:", tx.serialize().length);
  console.log("One tx:", NUM_NEW_ATA, "create ATA (idempotent). Sending...");
  const sig = await connection.sendTransaction(tx, { skipPreflight: false });
  console.log("Signature:", sig);
  await waitForConfirmation(sig);
  console.log("Confirmed. 15 ATAs created for mint from .env.");
  mainMenuWait(init);
}
