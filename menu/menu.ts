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
  console.log("\t[7] Exit");
};
