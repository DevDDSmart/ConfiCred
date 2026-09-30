/**
 * useMidnight — React hook wrapping the Midnight DApp connector and the
 * Midnight.js providers needed to call circuits on the preprod contract.
 *
 * Wallet side: Lace injects its InitialAPI under window.midnight (per the
 * dapp-connector-api globals). connect('preprod') returns a ConnectedAPI.
 *
 * Circuit side: circuits are called through midnight-js `findDeployedContract`
 * with providers whose walletProvider delegates to the Lace ConnectedAPI.
 *
 * Proving side: ZK proofs are generated on the user's machine — the key
 * material from our ZKConfigProvider (/zk artifacts) is handed to the wallet
 * via `dappConnectorProvingProvider`, and Lace proves inside the extension.
 * No proof preimage ever leaves the machine. If an older Lace build does not
 * expose `getProvingProvider`, we fall back to the public preprod proof
 * server and surface that in the UI (`provingMode === 'proof-server'`).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { InitialAPI, ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import { findDeployedContract } from '@midnight-ntwrk/midnight-js/contracts';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { dappConnectorProvingProvider } from '@midnight-ntwrk/midnight-js-dapp-connector-proof-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js/network-id';
import type { ProofProvider } from '@midnight-ntwrk/midnight-js/types';
import { createProofProvider } from '@midnight-ntwrk/midnight-js/types';
import * as ledger from '@midnight-ntwrk/midnight-js-protocol/ledger';
import {
  compiledContract,
  CONTRACT_ADDRESS,
  NETWORK,
  PRIVATE_STATE_ID,
  zkConfigProvider,
} from '../contract/registry';

export type WalletStatus =
  | 'checking' // detecting Lace presence
  | 'not-installed' // no window.midnight
  | 'disconnected'
  | 'connecting' // waiting for the user to approve in Lace
  | 'connected'
  | 'error';

export interface WalletState {
  status: WalletStatus;
  /** Unshielded (bech32m) address shown in the UI when connected. */
  address?: string;
  /** Human-readable error message for the error state. */
  error?: string;
  /** Wallet display name, e.g. "Lace". */
  walletName?: string;
}

/** Where ZK proofs are generated for this session. */
export type ProvingMode = 'wallet' | 'proof-server';

export interface CircuitCallResult {
  txId: string;
  blockHeight?: bigint;
}

const LS_KEY = 'conficred.connected.rdns';

function getLaceInitialApi(): InitialAPI | null {
  const injected = (window as unknown as { midnight?: Record<string, InitialAPI> }).midnight;
  if (!injected) return null;
  // Prefer Lace by rdns, else the first available wallet.
  const lace = Object.values(injected).find((api) => api.rdns === 'io.lace');
  return lace ?? Object.values(injected)[0] ?? null;
}

export function useMidnight() {
  const [wallet, setWallet] = useState<WalletState>({ status: 'checking' });
  const [api, setApi] = useState<ConnectedAPI | null>(null);
  const [proofProvider, setProofProvider] = useState<ProofProvider | null>(null);
  const [provingMode, setProvingMode] = useState<ProvingMode | null>(null);

  // Detect wallet presence on mount.
  useEffect(() => {
    const t = setTimeout(() => {
      setWallet((w) =>
        w.status === 'checking' ? { status: getLaceInitialApi() ? 'disconnected' : 'not-installed' } : w,
      );
    }, 300);
    return () => clearTimeout(t);
  }, []);

  const connect = useCallback(async () => {
    const initialApi = getLaceInitialApi();
    if (!initialApi) {
      setWallet({
        status: 'not-installed',
        error: 'No Midnight wallet detected. Install the Lace browser extension and reload this page.',
      });
      return;
    }
    setWallet({ status: 'connecting', walletName: initialApi.name });
    try {
      const connected = await initialApi.connect(NETWORK.networkId);
      setApi(connected);
      const { unshieldedAddress } = await connected.getUnshieldedAddress();
      setWallet({ status: 'connected', address: unshieldedAddress, walletName: initialApi.name });
      localStorage.setItem(LS_KEY, initialApi.rdns);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setWallet({
        status: /reject|denied|cancel/i.test(msg) ? 'disconnected' : 'error',
        error: /reject|denied|cancel/i.test(msg)
          ? 'Connection request was rejected in the wallet.'
          : `Wallet connection failed: ${msg}`,
      });
    }
  }, []);

  const disconnect = useCallback(() => {
    setApi(null);
    setProofProvider(null);
    setProvingMode(null);
    localStorage.removeItem(LS_KEY);
    setWallet(getLaceInitialApi() ? { status: 'disconnected' } : { status: 'not-installed' });
  }, []);

  // ─── Proving: delegate to the wallet (local machine), with a fallback ───────
  //
  // The wallet receives only the prover/verifier keys + ZKIR (public
  // artifacts fetched from /zk) and the serialized proof preimage. The
  // private witness stays inside the circuit pipeline on this machine.
  useEffect(() => {
    if (!api) {
      setProofProvider(null);
      setProvingMode(null);
      return;
    }
    let cancelled = false;
    setNetworkId('preprod');
    (async () => {
      try {
        if (typeof api.getProvingProvider === 'function') {
          const proving = await dappConnectorProvingProvider(api, zkConfigProvider);
          if (cancelled) return;
          setProofProvider(createProofProvider(proving));
          setProvingMode('wallet');
        } else {
          // Older Lace build without proving delegation: use the public
          // preprod proof server so the dApp still works.
          console.warn(
            'Connected wallet does not expose getProvingProvider — falling back to the preprod proof server.',
          );
          setProofProvider(httpClientProofProvider(NETWORK.proofServer, zkConfigProvider));
          setProvingMode('proof-server');
        }
      } catch (err: unknown) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          setWallet({ status: 'error', error: `Proving setup with the wallet failed: ${msg}` });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  // ─── Providers (built once wallet + proving are ready) ──────────────────────

  const providers = useMemo(() => {
    if (!api || !proofProvider) return null;
    const walletProvider = {
      async balanceTx(tx: unknown, _ttl?: Date) {
        // Serialize the unbound (proven, unbalanced) transaction and hand it
        // to Lace: balancing and fee payment happen inside the wallet.
        const serialized = (tx as { serialize: () => Uint8Array }).serialize();
        const { tx: balancedHex } = await api.balanceUnsealedTransaction(
          Buffer.from(serialized).toString('hex'),
          { payFees: true },
        );
        // Lace returns the sealed, balanced transaction as hex. Deserialize
        // with the sealed markers: signatures enabled, proof present, bound.
        const clean = (balancedHex as string).startsWith('0x') ? (balancedHex as string).slice(2) : (balancedHex as string);
        return ledger.Transaction.deserialize('signature', 'proof', 'binding', Buffer.from(clean, 'hex'));
      },
    };
    return {
      privateStateProvider: levelPrivateStateProvider({
        privateStateStoreName: 'conficred-frontend-state',
        accountId: 'browser-dapp',
        privateStoragePasswordProvider: () => Promise.resolve('Conficred-Dapp-Placeholder-Pwd-1'),
      }),
      publicDataProvider: indexerPublicDataProvider(NETWORK.indexer, NETWORK.indexerWS),
      zkConfigProvider,
      proofProvider,
      walletProvider,
      midnightProvider: walletProvider,
    };
  }, [api, proofProvider]);

  /** Read the on-chain registry state via the public data provider. */
  const readRegistry = useCallback(async () => {
    const provider = indexerPublicDataProvider(NETWORK.indexer, NETWORK.indexerWS);
    const state = await provider.queryContractState(CONTRACT_ADDRESS);
    if (!state) return null;
    const mod = (await import('../contract/credential-registry.js')) as any; // ledger() helper from the compiled artifact
    const ledgerState = mod.ledger(state.data);
    return {
      issuer: ledgerState.issuer.toString(),
      totalCredentials: ledgerState.totalCredentials.toString(),
      totalRevoked: ledgerState.totalRevoked.toString(),
      credentials: Array.from(ledgerState.credentials, ([k, v]: [Uint8Array, Uint8Array]) => ({
        id: Buffer.from(k).toString('hex').slice(0, 16),
        value: Buffer.from(v).toString('hex').slice(0, 16),
      })),
    };
  }, []);

  /** Submit a registerCredential circuit call through the deployed contract. */
  const callCircuit = useCallback(
    async (args: {
      holderSecret: string;
      issuer: string;
      credentialId: string;
    }): Promise<CircuitCallResult> => {
      if (!api || !providers) throw new Error('Wallet is not connected');
      const found = await findDeployedContract(providers as never, {
        compiledContract: compiledContract as never,
        contractAddress: CONTRACT_ADDRESS,
        privateStateId: PRIVATE_STATE_ID,
        initialPrivateState: {},
      });
      const tx = await (found as any).callTx.registerCredential(
        pad32(args.holderSecret),
        BigInt(args.issuer || '1'),
        pad32(args.credentialId),
      );
      return {
        txId: tx.public.txId,
        blockHeight: tx.public.blockHeight,
      };
    },
    [api, providers],
  );

  return {
    wallet,
    connect,
    disconnect,
    callCircuit,
    readRegistry,
    provingMode,
    isConnected: wallet.status === 'connected',
  };
}

function pad32(text: string): Uint8Array {
  const out = new Uint8Array(32);
  out.set(new TextEncoder().encode(text.trim()).slice(0, 32));
  return out;
}
