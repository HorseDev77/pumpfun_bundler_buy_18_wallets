import { checkMainWalletBalance } from "../services/wallet";
import { mainMenuWait } from "../core/utils";
import { init } from "../index";

export async function step1LoadWalletAndBalance() {
  console.log("=== Step 1: Load wallet & check balance ===\n");
  await checkMainWalletBalance();
  mainMenuWait(init);
}
