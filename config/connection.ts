import { Connection } from "@solana/web3.js";
import { RPC_URL, WS_URL } from "./env";

const opts: { commitment?: "processed" | "confirmed" | "finalized"; wsEndpoint?: string } = {
  commitment: "confirmed",
};
if (WS_URL) opts.wsEndpoint = WS_URL;

export const connection = new Connection(RPC_URL, opts);
