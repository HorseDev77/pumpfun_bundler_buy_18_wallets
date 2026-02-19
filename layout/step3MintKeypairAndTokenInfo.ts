import { createMintKeypair, loadMintKeypair, loadTokenInfoFromEnv } from "../services/tokenMint";
import { mainMenuWait } from "../core/utils";
import { init } from "../index";

export async function step3MintKeypairAndTokenInfo() {
  console.log("=== Step 3: Mint keypair & token info ===\n");
  let kp = loadMintKeypair();
  if (!kp) kp = createMintKeypair();
  const info = loadTokenInfoFromEnv();
  console.log("Mint:", kp.publicKey.toBase58());
  console.log("Token:", info.name, info.symbol, info.uri);
  mainMenuWait(init);
}
