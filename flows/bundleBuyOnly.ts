import {
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { ComputeBudgetProgram } from "@solana/web3.js";
import { checkMainWalletBalance } from "../services/wallet";
import {
  createBundlerWallets,
  loadBundlerKeypairs,
} from "../services/createWallets";
import { distributeSolToWallets } from "../services/distributeSol";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { bondingCurvePda } from "@pump-fun/pump-sdk";
import {
  buyInstructionsForUserInBundle,
  randomBundleBuySol,
  fetchGlobal,
  getFeeRecipientFromGlobal,
  fetchBondingCurveCreator,
  getTokenProgramForMint,
} from "../services/pump";
import {
  ensureLookupTable,
  getLookupTableAccount,
} from "../services/lookupTable";
import { buildCreateAtaInstructionsForOwners } from "../services/ata";
import { sendBloxRouteBundle, getBloxRouteTipInstruction } from "../services/bloxroute";
import {
  readBundlerWallets,
  readData,
  mainMenuWait,
  sleep,
  waitForConfirmation,
} from "../core/utils";
import {
  connection,
  BUNDLER_WALLET_COUNT,
  SOL_DISTRIBUTE_MAX,
  SOL_DISTRIBUTE_MIN,
  MINT_PUBLIC_KEY,
} from "../config";
import { init } from "../index";

const COMPUTE_UNIT_LIMIT = 400_000;
const COMPUTE_UNIT_PRICE = 100_000;
const TOTAL_BUNDLE_WALLETS = 5;
const WALLETS_PER_TX = 5;
/** Min SOL for distribution + LUT (if new) + create-ATA+buy fees + tip. No create-token cost. */
const MIN_MAIN_BALANCE_SOL = (SOL_DISTRIBUTE_MAX + 0.005) * BUNDLER_WALLET_COUNT + 0.15;

export async function runBundleBuyOnly() {
  console.log("=== Pump.fun Bundler: Bundle Buy Only (existing token, mint from .env) ===\n");

  if (!MINT_PUBLIC_KEY?.trim()) {
    console.error("Set MINT_PUBLIC_KEY in .env to the existing token mint address.");
    mainMenuWait(init);
    return;
  }

  const mint = new PublicKey(MINT_PUBLIC_KEY);

  const { keypair: mainWallet, balanceSol } = await checkMainWalletBalance();
  // if (balanceSol < MIN_MAIN_BALANCE_SOL) {
  //   console.error(`Low balance. Need at least ${MIN_MAIN_BALANCE_SOL.toFixed(2)} SOL.`);
  //   mainMenuWait(init);
  //   return;
  // }

  let bundlerWallets = readBundlerWallets("bundler");
  if (bundlerWallets.length === 0) {
    createBundlerWallets();
    bundlerWallets = readBundlerWallets("bundler");
  }

  const bundlerKeypairs = loadBundlerKeypairs(bundlerWallets).slice(0, BUNDLER_WALLET_COUNT);
  console.log("Bundler wallets:", bundlerKeypairs.length);

  console.log("\nDistributing SOL to bundler wallets...");
  //await distributeSolToWallets(mainWallet, bundlerKeypairs);
  await sleep(1000);

  let creator: PublicKey;
  try {
    creator = await fetchBondingCurveCreator(mint);
    console.log("Mint:", mint.toBase58(), "| creator:", creator.toBase58());
  } catch (e) {
    console.error("Token not found or bonding curve missing for mint.", e);
    mainMenuWait(init);
    return;
  }

  let tokenProgram: PublicKey;
  try {
    tokenProgram = await getTokenProgramForMint(mint);
    console.log("Token program (from mint.owner):", tokenProgram.toBase58());
  } catch (e) {
    console.error("Could not resolve token program for mint.", e);
    mainMenuWait(init);
    return;
  }

  const bondingCurve = bondingCurvePda(mint);
  const associatedBondingCurve = getAssociatedTokenAddressSync(mint, bondingCurve, true, tokenProgram);
  console.log("Bonding curve (PDA):", bondingCurve.toBase58());
  console.log("Associated bonding curve (curve ATA, used by buy):", associatedBondingCurve.toBase58());

  const data = readData<{ mintPublicKey?: string; lutAddress?: string }>();
  const currentMint = mint.toBase58();
  let lutAddress: string;

  if (data.lutAddress && data.mintPublicKey === currentMint) {
    const savedLut = data.lutAddress;
    const existing = await getLookupTableAccount(new PublicKey(savedLut));
    if (existing) {
      console.log("\n1) Using existing lookup table from data.json:", savedLut);
      lutAddress = savedLut;
    } else {
      console.log("\n1) Saved LUT invalid or deactivated, creating new lookup table...");
      lutAddress = (
        await ensureLookupTable(mint, creator, mainWallet, bundlerKeypairs)
      ).toBase58();
      data.lutAddress = lutAddress;
      data.mintPublicKey = currentMint;
      const { saveData } = await import("../core/utils");
      saveData(data);
    }
  } else {
    console.log("\n1) Creating lookup table (create, wait 20s, extend)...");
    lutAddress = (
      await ensureLookupTable(mint, creator, mainWallet, bundlerKeypairs)
    ).toBase58();
    data.lutAddress = lutAddress;
    data.mintPublicKey = currentMint;
    const { saveData } = await import("../core/utils");
    saveData(data);
  }

  const lookupTable = await getLookupTableAccount(new PublicKey(lutAddress));
  if (!lookupTable) {
    console.error("LUT verification failed. Abort.");
    mainMenuWait(init);
    return;
  }

  const global = await fetchGlobal();
  const bundleFeeRecipient = getFeeRecipientFromGlobal(global);
  const walletSlice = bundlerKeypairs.slice(0, TOTAL_BUNDLE_WALLETS);
  if (walletSlice.length < TOTAL_BUNDLE_WALLETS) {
    console.error(
      `Need ${TOTAL_BUNDLE_WALLETS} bundler wallets, have ${walletSlice.length}. Set BUNDLER_WALLET_COUNT >= ${TOTAL_BUNDLE_WALLETS}.`
    );
    mainMenuWait(init);
    return;
  }

  const cluster = process.env.CLUSTER ?? "devnet";
  // Fetch blockhash immediately before building bundle so it is fresh for submission
  const { blockhash } = await connection.getLatestBlockhash("confirmed");

  const createAtaAndBuyTxs: VersionedTransaction[] = [];
  for (let t = 0; t < TOTAL_BUNDLE_WALLETS; t += WALLETS_PER_TX) {
    const chunk = walletSlice.slice(t, t + WALLETS_PER_TX);
    const createAtaAndBuyInstructions: TransactionInstruction[] = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 600000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: COMPUTE_UNIT_PRICE }),
    ];
    for (let i = 0; i < chunk.length; i++) {
      const w = chunk[i];
      const createAtaIxs = buildCreateAtaInstructionsForOwners(
        mint,
        [w.publicKey],
        mainWallet.publicKey,
        tokenProgram
      );
      const solAmt = Math.min(randomBundleBuySol(), SOL_DISTRIBUTE_MIN * 0.85);
      const { instructions: buyIxs } = await buyInstructionsForUserInBundle(
        mint,
        creator,
        w.publicKey,
        solAmt,
        { ataAlreadyCreated: true, feeRecipient: bundleFeeRecipient, tokenProgram }
      );
      createAtaAndBuyInstructions.push(...createAtaIxs, ...buyIxs);
    }

    const msg = new TransactionMessage({
      payerKey: mainWallet.publicKey,
      recentBlockhash: blockhash,
      instructions: createAtaAndBuyInstructions,
    }).compileToV0Message([lookupTable]);

    const tx = new VersionedTransaction(msg);
    tx.sign([mainWallet, ...chunk]);
    console.log("Create ATA + buy tx", createAtaAndBuyTxs.length + 1, tx.serialize().length);
    createAtaAndBuyTxs.push(tx);
  }

  let bundle: VersionedTransaction[] = createAtaAndBuyTxs;
  if (cluster === "mainnet") {
    const tipMsg = new TransactionMessage({
      payerKey: mainWallet.publicKey,
      recentBlockhash: blockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: COMPUTE_UNIT_PRICE }),
        getBloxRouteTipInstruction(mainWallet.publicKey),
      ],
    }).compileToV0Message([]);
    const tipTx = new VersionedTransaction(tipMsg);
    tipTx.sign([mainWallet]);
    bundle = [...createAtaAndBuyTxs, tipTx];
    console.log("BloxRoute tip tx added as separate last tx.");
  }
  console.log(
    "\n2) Bundle built:",
    bundle.length,
    "txs" + (cluster === "mainnet" ? " (create-ATA+buy + 1 tip)" : " (create-ATA+buy)"),
    TOTAL_BUNDLE_WALLETS,
    "wallets"
  );

  if (cluster === "mainnet") {
    // Mainnet: simulate first tx to surface exact RPC error (CU, accounts, funds)
    console.log("Simulating first tx on mainnet RPC...");
    try {
      const sim = await connection.simulateTransaction(createAtaAndBuyTxs[0], {
        sigVerify: false,
        replaceRecentBlockhash: true,
      });
      const err = sim.value.err;
      const logs = sim.value.logs ?? [];4
      if (err) {
        console.error("Mainnet simulation FAILED:", typeof err === "object" ? JSON.stringify(err, null, 2) : err);
        if (logs.length) console.error("Logs:\n" + logs.join("\n"));
        console.error("Fix: check CU limit, bundler wallet SOL, PDAs, and slippage. Then retry.");
        mainMenuWait(init);
        return;
      }
      console.log("Mainnet simulation OK. Units consumed:", (sim as { value?: { unitsConsumed?: number } }).value?.unitsConsumed ?? "N/A");
    } catch (e) {
      console.error("Mainnet simulation threw:", e instanceof Error ? e.message : e);
      mainMenuWait(init);
      return;
    }
    const skipPreflight = true;
    // for (let i = 1; i < bundle.length; i++) {
     
    // }

    const sig = await connection.sendTransaction(createAtaAndBuyTxs[0], { skipPreflight });
    console.log("Bundle tx",  1, sig);
    await waitForConfirmation(sig);
    await sleep(600);
    
    // console.log("Sending bundle via BloxRoute...");
    // const result = await sendBloxRouteBundle(bundle);
    // console.log(result.confirmed ? "Bundle confirmed." : "Bundle not confirmed.");
  } else {
    console.log("Devnet: sending bundle txs in order...");
    const skipPreflight = true;
    for (let i = 0; i < bundle.length; i++) {
      const sig = await connection.sendTransaction(bundle[i], { skipPreflight });
      console.log("Bundle tx", i + 1, sig);
      await waitForConfirmation(sig);
      await sleep(600);
    }
  }

  console.log("\nDone.");
  mainMenuWait(init);
}
