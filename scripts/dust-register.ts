/**
 * Standalone DUST registration: registers NIGHT UTXOs for DUST generation.
 *
 * Split out of deploy.ts so a rejected registration can be retried in
 * isolation without re-running the whole deploy. Uses the wallet sync cache,
 * so on a warm cache this finishes in well under a minute.
 */
import { WebSocket } from 'ws';
import { resolveNetwork, getOrCreateWallet, formatWalletBackupNotice } from '../src/network';
import { createWallet, persistWalletState } from '../src/wallet';
import * as Rx from 'rxjs';

// @ts-expect-error Required for wallet sync
globalThis.WebSocket = WebSocket;

const { network, config: networkConfig } = resolveNetwork();
const WALLET = getOrCreateWallet(network);
{
  const notice = formatWalletBackupNotice(WALLET, network);
  if (notice) console.log(notice);
}

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 15_000;
const DUST_WAIT_TIMEOUT_MS = 5 * 60 * 1000;

async function main() {
  console.log(`\n─── DUST registration on ${network} ─────────────────────────────\n`);

  console.log('  Building wallet...');
  const walletCtx = await createWallet({ network, networkConfig, seed: WALLET.seed });
  console.log('  Syncing (warm cache → fast)...');
  let state = await walletCtx.wallet.waitForSyncedState();
  console.log('  ✓ Synced.\n');

  const unregistered = state.unshielded.availableCoins.filter(
    (c: any) => !c.meta?.registeredForDustGeneration,
  );

  if (unregistered.length === 0) {
    console.log('  All NIGHT UTXOs already registered for DUST generation. Nothing to do.');
  } else {
    console.log(`  ${unregistered.length} UTXO(s) to register.`);
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        // The re-sync between attempts matters: the recipe embeds chain-height
        // data, so a stale tip anchor can be rejected at transaction
        // validation. Re-syncing re-anchors the next attempt at the current tip.
        if (attempt > 1) {
          console.log(`  Re-syncing for a fresh tip anchor...`);
          state = await walletCtx.wallet.waitForSyncedState();
        }
        console.log(`  Attempt ${attempt}/${MAX_ATTEMPTS}: registering...`);
        const recipe = await walletCtx.wallet.registerNightUtxosForDustGeneration(
          unregistered,
          walletCtx.unshieldedKeystore.getPublicKey(),
          (payload) => walletCtx.unshieldedKeystore.signData(payload),
        );
        const finalized = await walletCtx.wallet.finalizeRecipe(recipe);
        await walletCtx.wallet.submitTransaction(finalized);
        console.log('  ✓ Registration transaction submitted.\n');
        break;
      } catch (err: any) {
        const msg = err?.cause?.message || err?.message || String(err);
        console.error(`  ❌ Attempt ${attempt} failed: ${msg.split('\n')[0]}`);
        if (attempt === MAX_ATTEMPTS) {
          console.error('\n  All attempts failed. Re-run later: npm run dust-register\n');
          await persistWalletState(network, walletCtx);
          await walletCtx.wallet.stop();
          process.exit(1);
        }
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }
    }
  }

  // Wait for DUST to actually materialize.
  const dustBalance = state.dust.balance(new Date());
  if (dustBalance > 0n) {
    console.log(`  DUST already available: ${dustBalance.toLocaleString()}`);
  } else {
    console.log('  Waiting for DUST generation...');
    try {
      await Rx.firstValueFrom(
        walletCtx.wallet.state().pipe(
          Rx.throttleTime(5000),
          Rx.filter((s) => s.isSynced),
          Rx.filter((s) => s.dust.balance(new Date()) > 0n),
          Rx.timeout({ first: DUST_WAIT_TIMEOUT_MS }),
        ),
      );
      console.log('  ✓ DUST generated.');
    } catch {
      console.log('  ⏳ No DUST yet after 5 min. Registration may still land —');
      console.log('     re-run `npm run dust-register` or `npm run deploy` to check.');
    }
  }

  const final = await walletCtx.wallet.waitForSyncedState();
  console.log(`\n  DUST balance: ${final.dust.balance(new Date()).toLocaleString()}`);

  await persistWalletState(network, walletCtx);
  await walletCtx.wallet.stop();
  console.log('\n─── Done ───────────────────────────────────────────────────────\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
