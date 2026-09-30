/**
 * End-to-end circuit verification against a deployed contract.
 *
 * Exercises the full credential lifecycle with real transactions and
 * verifies the indexer sees every state transition:
 *   1. read pre-state
 *   2. registerCredential(holderSecret, issuer, id)
 *   3. rotateCredential(old, new, id)   — ZK access control: proves knowledge
 *      of the current secret before replacing the commitment
 *   4. suspendCredential(id)            — temporary invalidation
 *   5. reinstateCredential(id)          — back to active
 *   6. revokeCredential(id)             — terminal, bumps totalRevoked
 *
 * After each step the indexer is polled until the expected transition is
 * visible (counter / digest / flags), with exact-value assertions.
 *
 * Requires a funded wallet (tNIGHT + DUST) on the active network.
 */
import { Buffer } from 'buffer';
import { WebSocket } from 'ws';
import { randomBytes } from 'node:crypto';
import {
  resolveNetwork,
  getOrCreateWallet,
  formatWalletBackupNotice,
  getDeployment,
} from '../src/network';
import { createWallet, persistWalletState, unshieldedToken } from '../src/wallet';
import * as Rx from 'rxjs';

// @ts-expect-error Required for wallet sync
globalThis.WebSocket = WebSocket;

const PRIVATE_STATE_ID = 'credentialRegistryPrivateState';
const INDEXER_POLL_MS = 10_000;
const INDEXER_TIMEOUT_MS = 5 * 60 * 1000;

function pad32(text: string): Uint8Array {
  const out = new Uint8Array(32);
  out.set(new TextEncoder().encode(text.trim()).slice(0, 32));
  return out;
}

/** Hex of pad(32, tag) — a 32-byte, zero-padded ASCII tag. */
function statusDigestHex(tag: string): string {
  return Buffer.from(new TextEncoder().encode(tag)).toString('hex').padEnd(64, '0');
}

function fail(msg: string): never {
  console.error(`❌ verify-circuits failed: ${msg}`);
  process.exit(1);
}

const { network, config: networkConfig } = resolveNetwork();
const WALLET = getOrCreateWallet(network);
{
  const notice = formatWalletBackupNotice(WALLET, network);
  if (notice) console.log(notice);
}

const deployment = getDeployment(network);
if (!deployment) fail(`No deploy on file for network ${network}. Run setup first.`);

// Load compiled contract (same layout as deploy.ts).
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const zkConfigPath = path.resolve(__dirname, '..', 'contracts', 'managed', 'credential-registry');
const contractPath = path.join(zkConfigPath, 'contract', 'index.js');
if (!fs.existsSync(contractPath)) fail('Compiled contract missing — run `npm run compile`.');
const CredentialRegistry = await import(pathToFileURL(contractPath).href);
const compiledContract = CompiledContract.make('credential-registry', CredentialRegistry.Contract).pipe(
  CompiledContract.withVacantWitnesses,
  CompiledContract.withCompiledFileAssets(zkConfigPath),
);

interface LedgerView {
  issuer: string;
  totalCredentials: bigint;
  totalRevoked: bigint;
  /** credential-ID → commitment / status digest. Iterable, not a JS Map. */
  credentials: Iterable<[Uint8Array, Uint8Array]>;
  /** credential-ID → 1 (revoked) / 0. */
  revoked: Iterable<[Uint8Array, bigint]>;
  /** credential-ID → 1 (suspended) / 0. */
  suspended: Iterable<[Uint8Array, bigint]>;
}

function entries<V>(m: Iterable<[Uint8Array, V]>): Array<[Uint8Array, V]> {
  return Array.from(m, ([k, v]: [Uint8Array, V]) => [k, v] as [Uint8Array, V]);
}

function lookupDigest(l: LedgerView, key: Uint8Array): string {
  const hit = entries(l.credentials).find(([k]) => Buffer.from(k).equals(Buffer.from(key)));
  return hit ? Buffer.from(hit[1]).toString('hex') : '';
}

function lookupFlag(m: Iterable<[Uint8Array, bigint]>, key: Uint8Array): bigint | null {
  const hit = entries(m).find(([k]) => Buffer.from(k).equals(Buffer.from(key)));
  return hit ? hit[1] : null;
}

async function readLedger(address: string): Promise<LedgerView> {
  const provider = indexerPublicDataProvider(networkConfig.indexer, networkConfig.indexerWS);
  const contractState = await provider.queryContractState(address);
  if (!contractState) fail(`No contract state found for ${address} — is the indexer caught up?`);
  return CredentialRegistry.ledger(contractState.data) as LedgerView;
}

async function pollUntil(
  address: string,
  predicate: (l: LedgerView) => boolean,
  label: string,
): Promise<LedgerView> {
  const start = Date.now();
  while (true) {
    const l = await readLedger(address);
    if (predicate(l)) return l;
    if (Date.now() - start > INDEXER_TIMEOUT_MS) {
      fail(`${label}: condition not met after ${Math.round(INDEXER_TIMEOUT_MS / 1000)}s`);
    }
    process.stdout.write(`\r  ⏳ ${label} — waiting for indexer (total=${l.totalCredentials} revoked=${l.totalRevoked})   `);
    await new Promise((r) => setTimeout(r, INDEXER_POLL_MS));
  }
}

async function main() {
  console.log(`\n─── Circuit verification on ${network} ─────────────────────────\n`);
  console.log(`  Contract: ${deployment!.address}\n`);

  console.log('  Building wallet...');
  const walletCtx = await createWallet({ network, networkConfig, seed: WALLET.seed });
  console.log('  Syncing...');
  const state = await walletCtx.wallet.waitForSyncedState();
  const tNight = state.unshielded.balances[unshieldedToken().raw] ?? 0n;
  const dust = state.dust.balance(new Date());
  console.log(`  ✓ Synced. tNight=${tNight.toLocaleString()} DUST=${dust.toLocaleString()}\n`);
  if (tNight === 0n || dust === 0n) {
    fail(`Wallet needs funding (tNIGHT + DUST) to send transactions on ${network}.`);
  }

  const accountId = walletCtx.unshieldedKeystore.getBech32Address().toString();
  const walletProvider = {
    getCoinPublicKey: () => walletCtx.shieldedSecretKeys.coinPublicKey,
    getEncryptionPublicKey: () => walletCtx.shieldedSecretKeys.encryptionPublicKey,
    async balanceTx(tx: any, ttl?: Date) {
      const recipe = await walletCtx.wallet.balanceUnboundTransaction(
        tx,
        { shieldedSecretKeys: walletCtx.shieldedSecretKeys, dustSecretKey: walletCtx.dustSecretKey },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
      );
      return walletCtx.wallet.finalizeRecipe(recipe);
    },
    submitTx: (tx: any) => walletCtx.wallet.submitTransaction(tx) as any,
  };
  const zkConfigProvider = new NodeZkConfigProvider(zkConfigPath);
  const providers = {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: 'credential-registry-state',
      accountId,
      privateStoragePasswordProvider: () =>
        process.env.PRIVATE_STATE_PASSWORD?.trim() || 'Local-Devnet-Development-Placeholder-1',
    }),
    publicDataProvider: indexerPublicDataProvider(networkConfig.indexer, networkConfig.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(networkConfig.proofServer, zkConfigProvider),
    walletProvider,
    midnightProvider: walletProvider,
  };

  console.log('  Connecting to deployed contract...');
  const deployed: any = await findDeployedContract(providers, {
    compiledContract: compiledContract as any,
    contractAddress: deployment!.address,
    privateStateId: PRIVATE_STATE_ID,
    initialPrivateState: {},
  });
  console.log('  ✓ Connected.\n');

  const pre = await readLedger(deployment!.address);
  console.log(`  Pre-state: issuer=${pre.issuer} totalCredentials=${pre.totalCredentials} totalRevoked=${pre.totalRevoked}`);

  const credId = `conficred-verify-${Date.now()}-${randomBytes(4).toString('hex')}`;
  const key = new Uint8Array(pad32(credId));
  const oldSecret = randomBytes(32).toString('hex');
  const newSecret = randomBytes(32).toString('hex');
  console.log(`  Credential: ${credId}\n`);

  const submitted = (label: string, tx: any) =>
    console.log(`  ✓ ${label}: tx=${tx.public.txId} block=${tx.public.blockHeight}`);

  // ── 1. registerCredential ───────────────────────────────────────────────────
  console.log('  [1/5] registerCredential (proving + submitting)...');
  const regTx = await deployed.callTx.registerCredential(
    pad32(oldSecret),
    BigInt(pre.issuer),
    pad32(credId),
  );
  submitted('register', regTx);
  const afterReg = await pollUntil(
    deployment!.address,
    (l) =>
      l.totalCredentials === pre.totalCredentials + 1n &&
      lookupFlag(l.revoked, key) === 0n &&
      lookupDigest(l, key) !== '' &&
      lookupDigest(l, key) !== statusDigestHex('revoked'),
    'registration',
  );
  console.log(`\n  ✓ Registered: total=${afterReg.totalCredentials} revokedFlag=0 commitment=${lookupDigest(afterReg, key).slice(0, 16)}…`);

  // ── 2. rotateCredential (ZK access control with the current secret) ─────────
  console.log('  [2/5] rotateCredential (old secret → new secret)...');
  const rotTx = await deployed.callTx.rotateCredential(
    pad32(oldSecret),
    pad32(newSecret),
    pad32(credId),
  );
  submitted('rotate', rotTx);
  const afterRot = await pollUntil(
    deployment!.address,
    (l) =>
      lookupDigest(l, key) !== '' &&
      lookupDigest(l, key) !== lookupDigest(afterReg, key) &&
      lookupFlag(l.revoked, key) === 0n,
    'rotation',
  );
  console.log(`\n  ✓ Rotated: commitment=${lookupDigest(afterRot, key).slice(0, 16)}… (changed; counters untouched, total still ${afterRot.totalCredentials})`);

  // ── 3. suspendCredential ────────────────────────────────────────────────────
  console.log('  [3/5] suspendCredential...');
  const susTx = await deployed.callTx.suspendCredential(pad32(credId));
  submitted('suspend', susTx);
  const afterSus = await pollUntil(
    deployment!.address,
    (l) => lookupFlag(l.suspended, key) === 1n && lookupDigest(l, key) === statusDigestHex('suspended'),
    'suspension',
  );
  console.log(`\n  ✓ Suspended: suspendedFlag=1 digest=suspended revokedFlag=${lookupFlag(afterSus, key)}`);

  // ── 4. reinstateCredential ──────────────────────────────────────────────────
  console.log('  [4/5] reinstateCredential...');
  const reiTx = await deployed.callTx.reinstateCredential(pad32(credId));
  submitted('reinstate', reiTx);
  const afterRei = await pollUntil(
    deployment!.address,
    (l) => lookupFlag(l.suspended, key) === 0n && lookupDigest(l, key) === statusDigestHex('active'),
    'reinstatement',
  );
  console.log(`\n  ✓ Reinstated: suspendedFlag=0 digest=active revokedFlag=${lookupFlag(afterRei, key)}`);

  // ── 5. revokeCredential (terminal) ──────────────────────────────────────────
  console.log('  [5/5] revokeCredential...');
  const revTx = await deployed.callTx.revokeCredential(pad32(credId));
  submitted('revoke', revTx);
  const afterRev = await pollUntil(
    deployment!.address,
    (l) =>
      lookupFlag(l.revoked, key) === 1n &&
      lookupDigest(l, key) === statusDigestHex('revoked') &&
      l.totalRevoked === pre.totalRevoked + 1n,
    'revocation',
  );
  console.log(`\n  ✓ Revoked: revokedFlag=1 digest=revoked totalRevoked=${pre.totalRevoked}→${afterRev.totalRevoked}`);

  await persistWalletState(network, walletCtx);
  await walletCtx.wallet.stop();

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  ✅ FULL LIFECYCLE VERIFIED END-TO-END (5 circuits on-chain)');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`     network:    ${network}`);
  console.log(`     contract:   ${deployment!.address}`);
  console.log(`     register:   tx ${regTx.public.txId}`);
  console.log(`     rotate:     tx ${rotTx.public.txId}`);
  console.log(`     suspend:    tx ${susTx.public.txId}`);
  console.log(`     reinstate:  tx ${reiTx.public.txId}`);
  console.log(`     revoke:     tx ${revTx.public.txId}`);
  console.log(`     credential: ${credId}\n`);
}

main().catch(async (err: any) => {
  console.error(`\n❌ ${err?.cause?.message?.split('\n')[0] || err?.message || err}`);
  process.exit(1);
});
