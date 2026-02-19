import {
  Keypair,
  PublicKey,
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
  buildCreateAtaTransactions,
} from "../services/ata";
import { sendJitoBundle } from "../services/jito";
import {
  readBundlerWallets,
  readData,
  saveData,
  mainMenuWait,
  sleep,
  waitForConfirmation,
} from "../core/utils";
import { connection, BUNDLER_WALLET_COUNT } from "../config";
import { init } from "../index";

const COMPUTE_UNIT_LIMIT = 400_000;
const COMPUTE_UNIT_PRICE = 100_000;
const ATA_BATCH = 6;
/** Buys per tx. ATAs are created in earlier bundle txs so each buy is 1 ix; 5 buys fit in one tx. */
const BUY_BATCH = 5;

export async function runCreateTokenAndBundleBuy() {
  console.log("=== Pump.fun Bundler: One Bundle (Create Token + Create ATAs + Bundle Buy) ===\n");

  const { keypair: mainWallet, balanceSol } = await checkMainWalletBalance();
  if (balanceSol < 0.1) {
    console.error("Low balance. Need at least ~0.1 SOL.");
    mainMenuWait(init);
    return;
  }

  let bundlerWallets = readBundlerWallets("bundler");
  if (bundlerWallets.length === 0) {
    createBundlerWallets();
    bundlerWallets = readBundlerWallets("bundler");
  }
  const bundlerKeypairs = loadBundlerKeypairs(bundlerWallets).slice(0, BUNDLER_WALLET_COUNT);
  console.log("Bundler wallets:", bundlerKeypairs.length);

  console.log("\nDistributing SOL to bundler wallets...");
  await distributeSolToWallets(mainWallet, bundlerKeypairs);
  await sleep(1000);

  let mintKeypair = loadMintKeypair();
  if (!mintKeypair) {
    mintKeypair = createMintKeypair();
  }
  const tokenInfo = loadTokenInfoFromEnv();
  console.log("Mint:", mintKeypair.publicKey.toBase58(), "|", tokenInfo.name, tokenInfo.symbol);

  const data = readData<{ mintPublicKey?: string; created?: boolean }>();
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

  // 1) Create fresh LUT for this run: create -> wait 20s -> extend -> verify
  console.log("\n1) Creating lookup table (create, wait 20s, extend)...");
  const lutAddress = await ensureLookupTable(
    mintKeypair.publicKey,
    mainWallet.publicKey,
    mainWallet,
    bundlerKeypairs
  );
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
  const createTokenMsg = new TransactionMessage({
    payerKey: mainWallet.publicKey,
    recentBlockhash: blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_LIMIT }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: COMPUTE_UNIT_PRICE }),
      ...createTokenIx.instructions,
    ],
  }).compileToV0Message([lookupTable]);
  const createTokenTx = new VersionedTransaction(createTokenMsg);
  createTokenTx.sign([mainWallet, mintKeypair]);
  console.log("Create token tx", createTokenTx.serialize().length);
  console.log(createTokenTx.message.staticAccountKeys.length);

  const createAtaTxs = buildCreateAtaTransactions(
    mintKeypair.publicKey,
    bundlerKeypairs,
    mainWallet,
    blockhash,
    lookupTable
  );

  const buyTxs: VersionedTransaction[] = [];
  const global = await fetchGlobal();
  const bundleFeeRecipient = getFeeRecipientFromGlobal(global);
  const slice = bundlerKeypairs.slice(0, 5);
  const ixs: import("@solana/web3.js").TransactionInstruction[] = [];
  for (const w of slice) {
    const solAmt = randomBundleBuySol();
    const { instructions } = await buyInstructionsForUserInBundle(
      mintKeypair.publicKey,
      mainWallet.publicKey,
      w.publicKey,
      solAmt,
      { ataAlreadyCreated: true, feeRecipient: bundleFeeRecipient }
    );
    ixs.push(...instructions);
  }
  const msg = new TransactionMessage({
    payerKey: mainWallet.publicKey,
    recentBlockhash: blockhash,
    instructions: ixs,
  }).compileToV0Message([lookupTable]);
  const tx = new VersionedTransaction(msg);
  tx.sign([mainWallet, ...slice]);
  console.log("Buy tx", 1, tx.serialize().length);
  console.log(tx.message.staticAccountKeys.length);
  buyTxs.push(tx);

  const bundle: VersionedTransaction[] = [
    createTokenTx,
    ...createAtaTxs,
    ...buyTxs,
  ];
  console.log("\n2) One bundle built:", bundle.length, "txs (create token +", createAtaTxs.length, "ATA +", buyTxs.length, "buy)");

  const cluster = process.env.CLUSTER ?? "devnet";
  if (cluster === "mainnet") {
    console.log("Sending bundle via Jito...");
    const result = await sendJitoBundle(bundle, mainWallet);
    if (result.confirmed) {
      data.mintPublicKey = mintKeypair.publicKey.toBase58();
      data.created = true;
      saveData(data);
    }
    console.log(result.confirmed ? "Bundle confirmed." : "Bundle not confirmed.");
  } else {
    console.log("Devnet: sending bundle txs in order...");
    for (let i = 0; i < bundle.length; i++) {
      const sig = await connection.sendTransaction(bundle[i], { skipPreflight: false });
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
