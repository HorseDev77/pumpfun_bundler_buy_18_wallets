import dotenv from "dotenv";
dotenv.config();

import { mainMenuDisplay, rl, screenClear } from "./menu/menu";
import { step1LoadWalletAndBalance } from "./layout/step1LoadWalletAndBalance";
import { step2CreateWalletsAndDistribute } from "./layout/step2CreateWalletsAndDistribute";
import { step3MintKeypairAndTokenInfo } from "./layout/step3MintKeypairAndTokenInfo";
import { step4CreateAtas } from "./layout/step4CreateAtas";
import { runCreateTokenAndBundleBuy } from "./flows/createTokenAndBundleBuy";
import { runGatherSol } from "./flows/gatherSol";

export function init() {
  screenClear();
  mainMenuDisplay();

  rl.question("\tChoice: ", (answer: string) => {
    const choice = parseInt(answer, 10);
    switch (choice) {
      case 1:
        step1LoadWalletAndBalance();
        break;
      case 2:
        step2CreateWalletsAndDistribute();
        break;
      case 3:
        step3MintKeypairAndTokenInfo();
        break;
      case 4:
        step4CreateAtas();
        break;
      case 5:
        runCreateTokenAndBundleBuy();
        break;
      case 6:
        runGatherSol();
        break;
      case 7:
        process.exit(0);
        break;
      default:
        console.log("\tInvalid choice.");
        setTimeout(init, 500);
    }
  });
}

init();
