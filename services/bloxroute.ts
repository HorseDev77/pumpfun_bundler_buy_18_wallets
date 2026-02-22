import {
  Connection,
  Keypair,
  VersionedTransaction,
  TransactionMessage,
  SystemProgram,
  LAMPORTS_PER_SOL,
  PublicKey,
  TransactionInstruction,
} from '@solana/web3.js';
import axios, { AxiosResponse } from 'axios';
import { connection } from '../config';

/**
 * BloxRoute Constants
 */
export const BLOXROUTE_SUBMIT_BATCH_URL = 'https://germany.solana.dex.blxrbdn.com/api/v2/submit-batch';
export const DEFAULT_TIP_AMOUNT_SOL = 0.001;
export const BLOXROUTE_TIP_ACCOUNTS = [
  'HWEoBxYs7ssKuudEjzjmpfJVX7Dvi7wescFsVx2L5yoY'
];

/** Return BloxRoute tip account public keys (for LUT / tip instruction). */
export function getBloxRouteTipAccountPublicKeys(): PublicKey[] {
  return BLOXROUTE_TIP_ACCOUNTS.map((a) => new PublicKey(a));
}

/** Create a single tip instruction (embed in any tx). */
export function getBloxRouteTipInstruction(payer: PublicKey): TransactionInstruction {
  const tipAccount = BLOXROUTE_TIP_ACCOUNTS[Math.floor(Math.random() * BLOXROUTE_TIP_ACCOUNTS.length)];
  if (!tipAccount) throw new Error('BloxRoute: no tip accounts available');
  return SystemProgram.transfer({
    fromPubkey: payer,
    toPubkey: new PublicKey(tipAccount),
    lamports: Math.floor(DEFAULT_TIP_AMOUNT_SOL * LAMPORTS_PER_SOL),
  });
}

/** Send bundle via BloxRoute (adds tip tx, submits batch). Returns { confirmed: true } on success. */
export async function sendBloxRouteBundle(
  bundle: VersionedTransaction[],
  payer: Keypair
): Promise<{ confirmed: boolean }> {
  const service = new BloxRouteService(connection);
  await service.sendBundle(bundle, payer);
  return { confirmed: true };
}

/**
 * BloxRoute Service - Handles bundle submission via BloxRoute
 */
export class BloxRouteService {
  private connection: Connection;

  constructor(connection: Connection) {
    this.connection = connection;
  }

  /**
   * Get random tip account
   */
  private getTipAccount(): string {
    const randomIndex = Math.floor(Math.random() * BLOXROUTE_TIP_ACCOUNTS.length);
    const tipAccount = BLOXROUTE_TIP_ACCOUNTS[randomIndex];
    
    if (!tipAccount) {
      throw new Error('BloxRoute: no tip accounts available');
    }
    
    return tipAccount;
  }

  /**
   * Create tip transaction
   */
  private async createTipTransaction(payer: Keypair): Promise<VersionedTransaction> {
    const tipAccount = this.getTipAccount();
    const tipInstruction = SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: new PublicKey(tipAccount),
      lamports: Math.floor(DEFAULT_TIP_AMOUNT_SOL * LAMPORTS_PER_SOL)
    });

    const { blockhash } = await this.connection.getLatestBlockhash();
    
    const messageV0 = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: blockhash,
      instructions: [tipInstruction]
    }).compileToV0Message();

    const transaction = new VersionedTransaction(messageV0);
    transaction.sign([payer]);

    return transaction;
  }

  /**
   * Send bundle via BloxRoute
   */
  async sendBundle(transactions: VersionedTransaction[], payer: Keypair): Promise<void> {

    // Simulate all transactions
    // for (const tx of transactions) {
    //   const simulatedTransaction = await this.connection.simulateTransaction(tx);
    //   console.log("Simulated transaction:", simulatedTransaction);
    // }
    
    const bundleTransactions = [...transactions];
    const tipTransaction = await this.createTipTransaction(payer);
    bundleTransactions.push(tipTransaction);

    // Convert transactions to base64 strings
    const entries = bundleTransactions.map(tx => {
      const serializedTx = tx.serialize();
      const base64Content = Buffer.from(serializedTx).toString('base64');
      return {
        transaction: {
          content: base64Content
        }
      };
    });

    const requestBody = { entries };

    const authToken = process.env.BLOXROUTE_AUTH_TOKEN;
    if (!authToken) {
      throw new Error('BLOXROUTE_AUTH_TOKEN environment variable not set');
    }

    try {
      const response: AxiosResponse = await axios.post(
        BLOXROUTE_SUBMIT_BATCH_URL,
        requestBody,
        {
          headers: {
            'Authorization': `${authToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.status >= 200 && response.status < 300) {
        const signature = response.data?.transactions;
        console.log('BloxRoute bundle submitted successfully:', signature);
      } else {
        const errorText = response.data || 'Unknown error';
        throw new Error(`BloxRoute API error: ${response.status} - ${errorText}`);
      }
    } catch (error: any) {
      if (error.response) {
        const errorText = error.response.data || 'Unknown error';
        throw new Error(`BloxRoute API error: ${error.response.status} - ${errorText}`);
      } else {
        throw new Error(`BloxRoute request failed: ${error.message}`);
      }
    }
  }
}
