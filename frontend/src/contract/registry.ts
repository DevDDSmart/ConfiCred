/**
 * Contract wiring for the browser: loads the compiled credential-registry
 * contract and the ZK artifacts (prover/verifier keys, ZKIR) produced by
 * `compact compile`, served statically from /zk.
 *
 * Everything here is public data — no secrets live in this module. The
 * holder's private witness is typed in the UI and only ever passed to the
 * proving system inside the proof pipeline; it never touches this code.
 */

// The compiled contract is the exact artifact `compact compile` emitted
// (copied verbatim to src/contract/credential-registry.js, with its .d.ts).
import { Contract } from './credential-registry.js';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import {
  ZKConfigProvider,
  createZKIR,
  createProverKey,
  createVerifierKey,
} from '@midnight-ntwrk/midnight-js/types';

export const CONTRACT_ADDRESS =
  '40919146318915fd52397826f35d3ba9933d64fdbeb173485f73e011f1b428f0';

export const PRIVATE_STATE_ID = 'credentialRegistryPrivateState';

/** Circuit IDs of the deployed contract's state-changing circuits. */
export const CIRCUITS = [
  'registerCredential',
  'rotateCredential',
  'suspendCredential',
  'reinstateCredential',
  'revokeCredential',
] as const;

export type CircuitName = (typeof CIRCUITS)[number];

/** Public preprod endpoints used by the dApp. Override via Vite env vars. */
export const NETWORK = {
  indexer: import.meta.env.VITE_INDEXER_URL ?? 'https://indexer.preprod.midnight.network/api/v4/graphql',
  indexerWS: import.meta.env.VITE_INDEXER_WS_URL ?? 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws',
  proofServer: import.meta.env.VITE_PROOF_SERVER_URL ?? 'https://proof-server.preprod.midnight.network',
  networkId: 'preprod' as const,
};

/**
 * Browser-side ZK config provider: serves the same artifacts as the Node
 * ZkConfigProvider (keys/<circuit>.prover|.verifier, zkir/<circuit>.bzkir),
 * but fetches them over HTTP from /zk — no filesystem in the browser.
 */
export class BrowserZkConfigProvider extends ZKConfigProvider<string> {
  private cache = new Map<string, Promise<Uint8Array>>();

  constructor(private baseUrl = '/zk') {
    super();
  }

  private fetchArtifact(subDir: string, circuitId: string, ext: string): Promise<Uint8Array> {
    const key = `${subDir}/${circuitId}${ext}`;
    let p = this.cache.get(key);
    if (!p) {
      p = fetch(`${this.baseUrl}/${key}`).then(async (r) => {
        if (!r.ok) throw new Error(`ZK artifact ${key} not found (${r.status})`);
        return new Uint8Array(await r.arrayBuffer());
      });
      this.cache.set(key, p);
    }
    return p;
  }

  async getProverKey(circuitId: string) {
    return createProverKey(await this.fetchArtifact('zk', circuitId, '.prover'));
  }

  async getVerifierKey(circuitId: string) {
    return createVerifierKey(await this.fetchArtifact('zk', circuitId, '.verifier'));
  }

  async getZKIR(circuitId: string) {
    return createZKIR(await this.fetchArtifact('zk', circuitId, '.bzkir'));
  }
}

export const zkConfigProvider = new BrowserZkConfigProvider();

/** The compiled contract handle used by midnight-js. */
export const compiledContract = CompiledContract.make(
  'credential-registry',
  Contract,
).pipe(CompiledContract.withVacantWitnesses);

export { Contract };
