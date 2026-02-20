import {
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { ComputeBudgetProgram } from "@solana/web3.js";
import {
  checkMainWalletBalance,
  loadMainWallet,
} from "../services/wallet";
import {
  createBundlerWallets,
  loadBundlerKeypairs,
} from "../services/createWallets";
import { distributeSolToWallets } from "../services/distributeSol";
import {
  createMintKeypair,
  loadMintKeypair,
  loadTokenInfoFromEnv,
} from "../services/tokenMint";
import {
  createTokenOnlyInstructions,
  buyInstructionsForUserInBundle,
  randomBundleBuySol,
  fetchGlobal,
  getFeeRecipientFromGlobal,
} from "../services/pump";
import {
  ensureLookupTable,
  getLookupTableAccount
} from "../services/lookupTable";
import {
  buildCreateAtaInstructionsForOwners,
  TOKEN_2022_PROGRAM_ID,
} from "../services/ata";
import { sendJitoBundle, getJitoTipInstruction } from "../services/jito";
import { sendBloxRouteBundle } from "../services/bloxroute";
import {
  readBundlerWallets,
  readData,
  saveData,
  mainMenuWait,
  sleep,
  waitForConfirmation,
} from "../core/utils";
import { connection, BUNDLER_WALLET_COUNT, isMainnet, SOL_DISTRIBUTE_MAX, SOL_DISTRIBUTE_MIN, BUNDLE_PROVIDER } from "../config";
import { init } from "../index";

const COMPUTE_UNIT_LIMIT = 400_000;
const COMPUTE_UNIT_PRICE = 100_000;
/** Total wallets in bundle: 20. Each tx has 5 wallets (create ATA + buy). So 4 txs for 20 wallets. */
const TOTAL_BUNDLE_WALLETS = 5;
const WALLETS_PER_TX = 5;
/** Min SOL so after distribution main wallet can pay LUT create/extend, create token (incl. metadata rent), create-ATA+buy fees, and Jito tip on mainnet. +0.25 prevents "Custom 12" (insufficient lamports) on metadata allocation. */
const MIN_MAIN_BALANCE_SOL = (SOL_DISTRIBUTE_MAX + 0.005) * BUNDLER_WALLET_COUNT + 0.25;

export async function runCreateTokenAndBundleBuy() {
  console.log("=== Pump.fun Bundler: One Bundle (Create Token + Create ATA + Buy per Wallet) ===\n");

  const { keypair: mainWallet, balanceSol } = await checkMainWalletBalance();
  // if (balanceSol < MIN_MAIN_BALANCE_SOL) {
  //   console.error(`Low balance. Need at least ${MIN_MAIN_BALANCE_SOL.toFixed(2)} SOL (distribution + LUT + create token + fees).`);
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
  // await distributeSolToWallets(mainWallet, bundlerKeypairs);
  // await sleep(1000);

  let mintKeypair = loadMintKeypair();
  if (!mintKeypair) {
    mintKeypair = createMintKeypair();
  }
  const tokenInfo = loadTokenInfoFromEnv();
  console.log("Mint:", mintKeypair.publicKey.toBase58(), "|", tokenInfo.name, tokenInfo.symbol);

  const data = readData<{ mintPublicKey?: string; created?: boolean; lutAddress?: string }>();
  // Only skip if token actually exists on-chain (bonding curve exists for this mint)
  const { bondingCurvePda } = await import("@pump-fun/pump-sdk");
  const bondingCurve = bondingCurvePda(mintKeypair.publicKey);
  const bondingCurveAccount = await connection.getAccountInfo(bondingCurve);
  const alreadyCreatedOnChain = bondingCurveAccount != null;
  if (alreadyCreatedOnChain) {
    console.log("\nToken already exists on-chain for this mint. Run with a new mint keypair (Step 3) for a fresh one-bundle launch.");
    mainMenuWait(init);
    return;
  }
  if (data.created === true && data.mintPublicKey === mintKeypair.publicKey.toBase58()) {
    data.created = false;
    saveData(data);
  }

  const currentMint = mintKeypair.publicKey.toBase58();
  let lutAddress: string;

  if (data.lutAddress && data.mintPublicKey === currentMint) {
    const savedLut = data.lutAddress;
    console.log("Saved LUT:", savedLut);
    const existing = await getLookupTableAccount(new PublicKey(savedLut));
    if (existing) {
      console.log("\n1) Using existing lookup table from data.json:", savedLut);
      lutAddress = savedLut;
    } else {
      console.log("\n1) Saved LUT invalid or deactivated, creating new lookup table...");
      lutAddress = (await ensureLookupTable(
        mintKeypair.publicKey,
        mainWallet.publicKey,
        mainWallet,
        bundlerKeypairs
      )).toBase58();
      data.lutAddress = lutAddress;
      data.mintPublicKey = currentMint;
      saveData(data);
    }
  } else {
    console.log("\n1) Creating lookup table (create, wait 20s, extend)...");
    lutAddress = (await ensureLookupTable(
      mintKeypair.publicKey,
      mainWallet.publicKey,
      mainWallet,
      bundlerKeypairs
    )).toBase58();
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

  // 2) Build bundle txs (create token + create ATAs + bundle buy), all using LUT where applicable
  const blockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;

  const createTokenIx = await createTokenOnlyInstructions(
    mintKeypair.publicKey,
    mainWallet.publicKey
  );
  const createTokenInstructions = [
    ...(isMainnet && BUNDLE_PROVIDER === "jito" ? [getJitoTipInstruction(mainWallet.publicKey)] : []),
    ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_LIMIT }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: COMPUTE_UNIT_PRICE }),
    ...createTokenIx.instructions,
  ];

  const createTokenMsg = new TransactionMessage({
    payerKey: mainWallet.publicKey,
    recentBlockhash: blockhash,
    instructions: createTokenInstructions,
  }).compileToV0Message([lookupTable]);
  const createTokenTx = new VersionedTransaction(createTokenMsg);
  createTokenTx.sign([mainWallet, mintKeypair]);
  console.log("Create token tx", createTokenTx.serialize().length);
  console.log(createTokenTx.message.staticAccountKeys.length);

  const global = await fetchGlobal();
  const bundleFeeRecipient = getFeeRecipientFromGlobal(global);
  const walletSlice = bundlerKeypairs.slice(0, TOTAL_BUNDLE_WALLETS);
  if (walletSlice.length < TOTAL_BUNDLE_WALLETS) {
    console.error(`Need ${TOTAL_BUNDLE_WALLETS} bundler wallets, have ${walletSlice.length}. Set BUNDLER_WALLET_COUNT >= ${TOTAL_BUNDLE_WALLETS}.`);
    mainMenuWait(init);
    return;
  }

  const createAtaAndBuyTxs: VersionedTransaction[] = [];
  for (let t = 0; t < TOTAL_BUNDLE_WALLETS; t += WALLETS_PER_TX) {
    const chunk = walletSlice.slice(t, t + WALLETS_PER_TX);
    const isLastTx = t + WALLETS_PER_TX >= TOTAL_BUNDLE_WALLETS;
    const createAtaAndBuyInstructions: TransactionInstruction[] = [
      //...(isMainnet && BUNDLE_PROVIDER === "bloxroute" && isLastTx ? [getJitoTipInstruction(mainWallet.publicKey)] : []),
    ];
    for (let i = 0; i < chunk.length; i++) {
      const w = chunk[i];
    const createAtaIxs = buildCreateAtaInstructionsForOwners(
      mintKeypair.publicKey,
      [w.publicKey],
      mainWallet.publicKey,
      TOKEN_2022_PROGRAM_ID
    );
      const solAmt = Math.min(randomBundleBuySol(), SOL_DISTRIBUTE_MIN * 0.85);
      const { instructions: buyIxs } = await buyInstructionsForUserInBundle(
        mintKeypair.publicKey,
        mainWallet.publicKey,
        w.publicKey,
        solAmt,
        { ataAlreadyCreated: true, feeRecipient: bundleFeeRecipient }
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
    console.log(tx.message.staticAccountKeys.length);
    createAtaAndBuyTxs.push(tx);
  }
  


  const bundle: VersionedTransaction[] = [
    createTokenTx,
    ...createAtaAndBuyTxs,
  ];
  console.log("\n2) One bundle built:", bundle.length, "txs (create token +", createAtaAndBuyTxs.length, "create-ATA+buy txs,", TOTAL_BUNDLE_WALLETS, "wallets)");


  const cluster = process.env.CLUSTER ?? "devnet";
  if (cluster === "mainnet") {
    console.log("Sending bundle via", BUNDLE_PROVIDER === "bloxroute" ? "BloxRoute" : "Jito", "...");
    const result =
      BUNDLE_PROVIDER === "bloxroute"
        ? await sendBloxRouteBundle(bundle)
        : await sendJitoBundle(bundle, mainWallet);
    if (result.confirmed) {
      data.mintPublicKey = mintKeypair.publicKey.toBase58();
      data.created = true;
      saveData(data);
    }

    console.log(result.confirmed ? "Bundle confirmed." : "Bundle not confirmed.");

  } else {
    console.log("Devnet: sending bundle txs in order...");
    const skipPreflight = true;
    if (skipPreflight) console.log("(skipPreflight: true to avoid 'Max instruction trace length exceeded' on create-token tx)");
    for (let i = 0; i < bundle.length; i++) {
      const sig = await connection.sendTransaction(bundle[i], { skipPreflight });
      console.log("Bundle tx", i + 1, sig);
      await waitForConfirmation(sig);
      await sleep(600);
    }
    data.mintPublicKey = mintKeypair.publicKey.toBase58();
    data.created = true;
    saveData(data);
  }

  console.log("\nDone.");
  mainMenuWait(init);
}
