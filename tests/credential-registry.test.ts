/**
 * Unit tests for the ConfiCred credential-registry contract.
 *
 * Runs the compiled contract (contracts/managed/credential-registry) on the
 * local compact-runtime with mock proofs — no network, no proof server.
 * Covers: circuit logic, state transitions, and privacy guarantees.
 */
import { describe, expect, it } from 'vitest';

import {
  createCircuitContext,
  dummyContractAddress,
  dummyUserAddress,
} from '@midnight-ntwrk/compact-runtime';
import * as ocrt from '@midnight-ntwrk/onchain-runtime-v3';
import { Contract, ledger as readLedger } from '../contracts/managed/credential-registry/contract';

// ─── Test helpers ─────────────────────────────────────────────────────────────

const encoder = new TextEncoder();

/** 32-byte string from a short ASCII tag (deterministic filler for the tail). */
function bytes32(tag: string): Uint8Array {
  const raw = encoder.encode(tag);
  const out = new Uint8Array(32);
  out.set(raw.slice(0, 32), 0);
  for (let i = raw.length; i < 32; i++) out[i] = i;
  return out;
}

/**
 * A contract bound to a mutable offchain ledger. Each impure-circuit call
 * returns an evolved CircuitContext; tests chain it so later calls see
 * earlier writes (as consecutive blocks would on-chain).
 *
 * Initial state comes from the compiled contract's own initialState(), so
 * the ledger layout (issuer cell, counter cell, credentials map) is always
 * exactly what the compiler generated — no hand-mirroring.
 */
function makeContract() {
  const contract = new Contract({});

  const initState = contract.initialState({
    initialZswapLocalState: { coinPublicKey: dummyUserAddress() },
    initialPrivateState: {}, // this contract has no private state
  });
  const contractState = initState.currentContractState;

  let ctx: any = createCircuitContext(
    dummyContractAddress(),
    dummyUserAddress(),
    contractState.data,
    initState.currentPrivateState,
  );

  return {
    contract,
    call(circuit: string, ...args: unknown[]) {
      const results = contract.impureCircuits[circuit](ctx as never, ...(args as never[]));
      ctx = results.context;
      return results;
    },
    ledger() {
      // Read through the evolved query context's charged state.
      return readLedger(ctx.currentQueryContext.state);
    },
  };
}

type CredContract = ReturnType<typeof makeContract>;

// ─── 1. Circuit logic ─────────────────────────────────────────────────────────

describe('circuit logic', () => {
  it('registerCredential stores the hash of the holder secret, not the secret', () => {
    const c = makeContract();
    const secret = bytes32('alice-secret');
    const credId = bytes32('credential-001');

    c.call('registerCredential', secret, 1n, credId);

    const state = c.ledger();
    expect(state.totalCredentials).toBe(1n);
    expect(state.credentials.member(credId)).toBe(true);
    expect(Buffer.from(state.credentials.lookup(credId))).not.toEqual(Buffer.from(secret));
  });

  it('distinct secrets produce distinct commitments', () => {
    const c = makeContract();
    const credA = bytes32('credential-A');
    const credB = bytes32('credential-B');

    c.call('registerCredential', bytes32('alice'), 1n, credA);
    c.call('registerCredential', bytes32('bob'), 2n, credB);

    const state = c.ledger();
    expect(Buffer.from(state.credentials.lookup(credA))).not.toEqual(
      Buffer.from(state.credentials.lookup(credB)),
    );
    expect(state.totalCredentials).toBe(2n);
  });
});

// ─── 2. State transitions ─────────────────────────────────────────────────────

describe('state transitions', () => {
  it('counter increments across sequential registrations', () => {
    const c = makeContract();

    for (let i = 1; i <= 3; i++) {
      c.call(
        'registerCredential',
        bytes32(`secret-${i}`),
        BigInt(i),
        bytes32(`credential-${i}`),
      );
      expect(c.ledger().totalCredentials).toBe(BigInt(i));
    }
  });

  it('revokeCredential overwrites the commitment; count and issuer unchanged', () => {
    const c = makeContract();
    const credId = bytes32('credential-revoke-me');

    c.call('registerCredential', bytes32('carol'), 7n, credId);
    const committed = c.ledger().credentials.lookup(credId);

    c.call('revokeCredential', credId);

    const after = c.ledger();
    expect(after.totalCredentials).toBe(1n); // revocation is not a new registration
    expect(Buffer.from(after.credentials.lookup(credId))).not.toEqual(Buffer.from(committed));
    expect(after.issuer).toBe(7n);
  });
});

// ─── 3. Privacy guarantees ────────────────────────────────────────────────────

describe('privacy', () => {
  it('public ledger state never contains the raw holder secret', () => {
    const c = makeContract();
    const secret = bytes32('topsecret-holder-value');

    c.call('registerCredential', secret, 1n, bytes32('credential-privacy'));

    // Serialize everything publicly readable and search for the secret.
    const state = c.ledger();
    const serialized = JSON.stringify(
      {
        issuer: state.issuer.toString(),
        totalCredentials: state.totalCredentials.toString(),
        credentials: Array.from(state.credentials, ([k, v]: [Uint8Array, Uint8Array]) => [
          Buffer.from(k).toString('hex'),
          Buffer.from(v).toString('hex'),
        ]),
      },
      null,
      2,
    );
    const secretHex = Buffer.from(secret).toString('hex');
    expect(serialized).not.toContain('topsecret-holder-value');
    expect(serialized).not.toContain(secretHex);
  });

  it('same secret yields the same commitment without revealing the secret', () => {
    const c = makeContract();
    const secret = bytes32('determinism-check');
    const id1 = bytes32('det-1');
    const id2 = bytes32('det-2');

    c.call('registerCredential', secret, 1n, id1);
    c.call('registerCredential', secret, 1n, id2);

    const state = c.ledger();
    // Deterministic: same secret -> same commitment under both ids.
    expect(Buffer.from(state.credentials.lookup(id1))).toEqual(
      Buffer.from(state.credentials.lookup(id2)),
    );
    // Hiding: the commitment is not the secret itself (preimage concealed).
    expect(state.credentials.lookup(id1).length).toBe(32);
    expect(Buffer.from(state.credentials.lookup(id1))).not.toEqual(Buffer.from(secret));
  });
});
