export interface BundlerState {
  mintKeypairPath?: string;
  mintPublicKey?: string;
  tokenName: string;
  tokenSymbol: string;
  tokenUri: string;
  mainWalletPubkey?: string;
  bundlerWalletCount: number;
}

export interface TokenInfo {
  name: string;
  symbol: string;
  uri: string;
  decimals: number;
}
