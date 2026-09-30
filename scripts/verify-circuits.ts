/**
 * End-to-end circuit verification against a deployed contract.
 *
 * Exercises BOTH circuits with real transactions and verifies the indexer
 * sees every state transition:
 *   1. read pre-state (issuer / totalCredentials / credentials map)
 *   2. registerCredential with a fresh unique credential ID
 *   3. poll the indexer until the registration is visible; assert issuer,
 *      totalCredentials +1, and the new map entry
 *   4. revokeCredential on the same ID
 *   5. poll until the commitment is overwritten with the zero ("revoked") digest
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

const REVOKED_DIGEST_HEX = Buffer.from(new TextEncoder().encode('revoked'))
  .toString('hex')
  .padEnd(64, '0');

interface LedgerView {
  issuer: string;
  totalCredentials: bigint;
  /** compact-runtime map type: iterable of entries, but not a JS Map. */
  credentials: Iterable<[Uint8Array, Uint8Array]>;
}

function credEntries(l: LedgerView): Array<[Uint8Array, Uint8Array]> {
  return Array.from(l.credentials, ([k, v]: [Uint8Array, Uint8Array]) => [k, v] as [Uint8Array, Uint8Array]);
}

async function readLedger(address: string): Promise<LedgerView> {
  const provider = indexerPublicDataProvider(networkConfig.indexer, networkConfig.indexerWS);
  const contractState = await provider.queryContractState(address);
  if (!contractState) fail(`No contract state found for ${address} — is the indexer caught up?`);
  const ledger = CredentialRegistry.ledger(contractState.data) as LedgerView;
  return ledger;
}

async function pollUntil(
  address: string,
  predicate: (l: LedgerView) => boolean,
  label: string,
): Promise<LedgerView> {
  const start = Date.now();
  let last = '';
  while (true) {
    const l = await readLedger(address);
    if (predicate(l)) return l;
    if (Date.now() - start > INDEXER_TIMEOUT_MS) {
      fail(`${label}: condition not met after ${Math.round(INDEXER_TIMEOUT_MS / 1000)}s. Last state: ${last}`);
    }
    last = `totalCredentials=${l.totalCredentials}`;
    process.stdout.write(`\r  ⏳ ${label} — waiting for indexer... (${last})   `);
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

  // 1. Pre-state.
  const pre = await readLedger(deployment!.address);
  console.log(`  Pre-state: issuer=${pre.issuer} totalCredentials=${pre.totalCredentials}`);

  // 2. registerCredential with a unique, self-describing ID.
  const credId = `conficred-verify-${Date.now()}-${randomBytes(4).toString('hex')}`;
  const holderSecret = randomBytes(32).toString('hex');
  console.log(`\n  Registering credential: ${credId}`);
  console.log('  (proving + submitting — this can take 30–90s)');
  const regTx = await deployed.callTx.registerCredential(
    pad32(holderSecret),
    BigInt(pre.issuer),
    pad32(credId),
  );
  console.log(`  ✓ registerCredential submitted: tx=${regTx.public.txId} block=${regTx.public.blockHeight}`);

  // 3. Verify registration via the indexer.
  const credKey = new Uint8Array(pad32(credId));
  const afterReg = await pollUntil(
    deployment!.address,
    (l) =>
      l.totalCredentials === pre.totalCredentials + 1n &&
      credEntries(l).some(([k]) => Buffer.from(k).equals(Buffer.from(credKey))),
    'registration',
  );
  const commitment = credEntries(afterReg).find(([k]) =>
    Buffer.from(k).equals(Buffer.from(credKey)),
  )![1];
  const commitmentHex = Buffer.from(commitment).toString('hex');
  const isZeroDigest = commitmentHex === REVOKED_DIGEST_HEX;
  console.log(`\n  ✓ Registration verified on indexer:`);
  console.log(`     totalCredentials: ${pre.totalCredentials} → ${afterReg.totalCredentials}`);
  console.log(`     commitment[${credId.slice(0, 24)}…]: ${commitmentHex.slice(0, 24)}…${isZeroDigest ? ' (⚠ zero digest!)' : ''}`);
  if (isZeroDigest) fail('Registration stored the revoked zero digest — circuit state transition is wrong.');

  // 4. revokeCredential.
  console.log(`\n  Revoking credential: ${credId}`);
  const revTx = await deployed.callTx.revokeCredential(pad32(credId));
  console.log(`  ✓ revokeCredential submitted: tx=${revTx.public.txId} block=${revTx.public.blockHeight}`);

  // 5. Verify revocation via the indexer.
  await pollUntil(
    deployment!.address,
    (l) =>
      credEntries(l).some(
        ([k, v]) =>
          Buffer.from(k).equals(Buffer.from(credKey)) &&
          Buffer.from(v).toString('hex') === REVOKED_DIGEST_HEX,
      ),
    'revocation',
  );
  console.log(`\n  ✓ Revocation verified on indexer: commitment == zero digest`);

  await persistWalletState(network, walletCtx);
  await walletCtx.wallet.stop();

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  ✅ BOTH CIRCUITS VERIFIED END-TO-END');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`     network:    ${network}`);
  console.log(`     contract:   ${deployment!.address}`);
  console.log(`     register:   tx ${regTx.public.txId}`);
  console.log(`     revoke:     tx ${revTx.public.txId}`);
  console.log(`     credential: ${credId}\n`);
}

main().catch(async (err: any) => {
  console.error(`\n❌ ${err?.cause?.message?.split('\n')[0] || err?.message || err}`);
  process.exit(1);
});
