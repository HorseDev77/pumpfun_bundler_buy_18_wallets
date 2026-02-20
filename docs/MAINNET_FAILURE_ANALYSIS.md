# Mainnet Failure Analysis: Bundle Buy Only

This document explains why the bundle worked on devnet but **failed mainnet RPC simulation** and **timed out via BloxRoute**, and what was changed to fix it.

---

## 1. Account checks

| Check | Status | Notes |
|-------|--------|--------|
| **ATAs** | ✅ | Create-ATA instructions are in the same tx as buys; ATAs are created before first use. Token program comes from `getTokenProgramForMint(mint)` (Token-2022 for Pump). |
| **PDAs** | ✅ | Bonding curve, creator vault, fee recipient come from chain via `fetchGlobal()` and `fetchBondingCurve()`. No hardcoded PDAs. |
| **Signers funded** | ❌ **WAS BROKEN** | **Bundler wallets were not funded on mainnet:** `distributeSolToWallets` was commented out. Pump buy spends SOL from the **buyer** (each `w` in the chunk). With 0 SOL, simulation fails (insufficient funds). **Fix:** Uncommented `distributeSolToWallets` so bundler wallets receive SOL before building the bundle. |

---

## 2. Program state

- Global and bonding curve are fetched from **current RPC** (`connection`), so mainnet vs devnet state is correct.
- Fee recipient is chosen by the SDK from the on-chain global (and bonding curve `isMayhemMode`), so it matches program expectations.

---

## 3. Compute units

| Item | Before | After |
|------|--------|--------|
| **CU limit** | Default 200,000 | **600,000** on the create-ATA+buy tx |
| **CU usage** | One tx = 5× create ATA + 5× buy → easily **300k–500k+** | 200k default was too low; simulation could fail with "exceeded CUs" or similar. |
| **Priority** | None on main tx | **setComputeUnitPrice(COMPUTE_UNIT_PRICE)** (100,000 microLamports) added so the tx is competitive. |

**Fix:** Prepend `ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 })` and `ComputeBudgetProgram.setComputeUnitPrice({ microLamports: COMPUTE_UNIT_PRICE })` to the create-ATA+buy instructions.

---

## 4. Fees and priority

- **BloxRoute tip:** Last tx is a dedicated tip tx (correct order: `[...createAtaAndBuyTxs, tipTx]`). `BLOXROUTE_TIP_LAMPORTS` (default 1_000_000 = 0.001 SOL) meets BloxRoute minimum.
- **Priority on main tx:** Now set (see above). Tip tx already had 100k CU limit and 100k microLamports.

---

## 5. Blockhash validity

- **Before:** Blockhash was fetched once near the start of the flow (after LUT resolution), then reused for all txs. By the time the bundle was built and sent (or BloxRoute responded after 35s), the blockhash could be **expired** (~60–90s validity).
- **Fix:** Blockhash is now fetched **immediately before** building the bundle (`getLatestBlockhash("confirmed")` right before the loop that builds `createAtaAndBuyTxs` and the tip tx), so it is fresh for submission.

---

## 6. Transaction logic

- Slippage: 8% in `pump.ts` (`SLIPPAGE_FRACTION`) for bundle buys.
- Token program and decimals: Derived from mint (Token-2022). Amounts use `getBuyTokenAmountFromSolAmount` with live bonding curve state.
- No change to core buy logic; failures were due to **funding**, **CU**, and **blockhash/timing**, not decimals or program checks.

---

## 7. Simulation logs

- **Before:** No mainnet simulation was run before sending to BloxRoute, so the exact RPC error was unknown.
- **Fix:** On mainnet, before calling `sendBloxRouteBundle`, the first tx (`bundle[0]`) is simulated with `connection.simulateTransaction(bundle[0], { sigVerify: false, replaceRecentBlockhash: true })`. If it fails, the **error and logs** are printed and the flow exits without sending. This gives the exact mainnet failure reason (CU, account missing, insufficient funds, etc.).

---

## 8. Bundler timing

- BloxRoute submit was timing out (35s) because the server can take a long time to validate/simulate the bundle. Network checks showed the endpoint is reachable and returns quickly for minimal requests; with a real bundle, response time can exceed 35s.
- **Fix:** Submit-batch timeout increased from **35s to 60s** in `services/bloxroute.ts`.

---

## Step-by-step reason it failed on mainnet

1. **Bundler wallets had no SOL** → Pump buy instructions debit the buyer; with 0 balance, simulation fails (insufficient funds).
2. **Default CU limit (200k) too low** → One tx with 5 create-ATAs + 5 buys exceeds 200k CU → simulation fails or would fail at execution.
3. **No priority fee on main tx** → On mainnet, 0 priority can lead to slow or failed inclusion (secondary to the above).
4. **Blockhash could be stale** → If there was delay between fetch and submit (or long BloxRoute response), blockhash might be expired → bundle rejected or timeout.
5. **BloxRoute HTTP timeout (35s)** → Server sometimes takes longer to respond to submit-batch → client timeout before receiving bundleHash.

---

## Precise adjustments made

| Area | Adjustment |
|------|------------|
| **Accounts** | Uncommented `distributeSolToWallets(mainWallet, bundlerKeypairs)` so bundler wallets are funded before building the bundle. |
| **CU** | Added `setComputeUnitLimit(600_000)` and `setComputeUnitPrice(COMPUTE_UNIT_PRICE)` to the create-ATA+buy tx. |
| **Fees / tip** | Tip was already last and ≥ 0.001 SOL; no change. |
| **Blockhash** | Moved `getLatestBlockhash("confirmed")` to immediately before building the bundle (and use the same blockhash for all txs in that bundle). |
| **Simulation** | On mainnet, simulate `bundle[0]` before `sendBloxRouteBundle`; on failure, log error + logs and exit without sending. |
| **BloxRoute** | Increased submit-batch timeout from 35s to 60s. |

---

## How to verify

1. Run **Bundle buy only** on mainnet with `MINT_PUBLIC_KEY` set to an existing Pump token.
2. If mainnet simulation fails, the console will show the exact error and logs; fix the reported issue (e.g. more CU, more SOL per wallet).
3. If simulation passes, the bundle is sent to BloxRoute; if it still times out, consider 90s timeout or try another BloxRoute region (e.g. NY vs Amsterdam).
