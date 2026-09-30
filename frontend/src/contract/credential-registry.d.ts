import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type Witnesses<PS> = {
}

export type ImpureCircuits<PS> = {
  registerCredential(context: __compactRuntime.CircuitContext<PS>,
                     holderSecret_0: Uint8Array,
                     issuerId_0: bigint,
                     credentialId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  revokeCredential(context: __compactRuntime.CircuitContext<PS>,
                   credentialId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  rotateCredential(context: __compactRuntime.CircuitContext<PS>,
                   holderSecret_0: Uint8Array,
                   newHolderSecret_0: Uint8Array,
                   credentialId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  suspendCredential(context: __compactRuntime.CircuitContext<PS>,
                    credentialId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  reinstateCredential(context: __compactRuntime.CircuitContext<PS>,
                      credentialId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type ProvableCircuits<PS> = {
  registerCredential(context: __compactRuntime.CircuitContext<PS>,
                     holderSecret_0: Uint8Array,
                     issuerId_0: bigint,
                     credentialId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  revokeCredential(context: __compactRuntime.CircuitContext<PS>,
                   credentialId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  rotateCredential(context: __compactRuntime.CircuitContext<PS>,
                   holderSecret_0: Uint8Array,
                   newHolderSecret_0: Uint8Array,
                   credentialId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  suspendCredential(context: __compactRuntime.CircuitContext<PS>,
                    credentialId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  reinstateCredential(context: __compactRuntime.CircuitContext<PS>,
                      credentialId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type PureCircuits = {
  isCredentialRevoked(credentialId_0: Uint8Array): [];
  isCredentialSuspended(credentialId_0: Uint8Array): [];
}

export type Circuits<PS> = {
  registerCredential(context: __compactRuntime.CircuitContext<PS>,
                     holderSecret_0: Uint8Array,
                     issuerId_0: bigint,
                     credentialId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  revokeCredential(context: __compactRuntime.CircuitContext<PS>,
                   credentialId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  rotateCredential(context: __compactRuntime.CircuitContext<PS>,
                   holderSecret_0: Uint8Array,
                   newHolderSecret_0: Uint8Array,
                   credentialId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  suspendCredential(context: __compactRuntime.CircuitContext<PS>,
                    credentialId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  reinstateCredential(context: __compactRuntime.CircuitContext<PS>,
                      credentialId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  isCredentialRevoked(context: __compactRuntime.CircuitContext<PS>,
                      credentialId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  isCredentialSuspended(context: __compactRuntime.CircuitContext<PS>,
                        credentialId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type Ledger = {
  readonly issuer: bigint;
  readonly totalCredentials: bigint;
  readonly totalRevoked: bigint;
  credentials: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): Uint8Array;
    [Symbol.iterator](): Iterator<[Uint8Array, Uint8Array]>
  };
  revoked: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): bigint;
    [Symbol.iterator](): Iterator<[Uint8Array, bigint]>
  };
  suspended: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): bigint;
    [Symbol.iterator](): Iterator<[Uint8Array, bigint]>
  };
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
