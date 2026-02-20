import readline from "readline";

export const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

export const screenClear = () => {
  console.clear();
};

export const mainMenuDisplay = () => {
  console.log("\n\tPump.fun Bundler");
  console.log("\t[1] Load wallet & check balance");
  console.log("\t[2] Create wallets & distribute SOL");
  console.log("\t[3] Create mint keypair & load token info");
  console.log("\t[4] Create ATAs for token");
  console.log("\t[5] Create token & dev buy + Jito bundle buy (full flow)");
  console.log("\t[6] Gather SOL from wallets");
  console.log("\t[7] Bundle buy only (existing token, mint from .env)");
  console.log("\t[8] Close main wallet ATAs & gather SOL");
  console.log("\t[9] Close all LUTs (wallets/lookuptable.txt) & reclaim SOL");
  console.log("\t[10] Create token + 15 ATAs (one tx; 5 already exist)");
  console.log("\t[11] Exit");
};
