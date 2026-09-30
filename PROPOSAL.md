# Product Proposal

## What is the product, and who uses it?

ConfiCred is a zero-knowledge credential registry: issuers anchor tamper-proof
commitments to credentials on Midnight, and holders prove ownership of a
credential without ever revealing the secret behind it.

Three concrete user groups, each with a pain the product removes:

- **Issuers** — universities, licensing boards, employers, membership
  organizations — enroll each credential once, on-chain. Today they run
  manual verification hotlines and honey-pot databases of personal data;
  ConfiCred replaces both with a public registry their users can self-serve
  from.
- **Holders** — graduates, licensed professionals, employees, members — hold
  one secret per credential. If it leaks, they rotate it on-chain (ZK access
  control: prove knowledge of the current secret to replace it) instead of
  waiting for the issuer to reissue.
- **Verifiers** — employers, regulators, venues — check that a credential
  exists, is active, and is not revoked by reading public ledger state.
  No phone calls to the issuer, no trust in a third-party API, and nothing
  learned about the holder beyond what the holder shows.

## Why Midnight specifically?

A transparent chain (Ethereum, Solana, and friends) can store a registry, but
every write is world-readable, so it creates the exact problem credentials
are supposed to solve: a permanent public database of who holds which
credential, correlatable across issuers, marketable, and uncensorable. There
is no way to put a secret in a public ledger's storage and keep it secret.

Midnight is the only chain where this product's core promise is expressible
directly in the contract language:

- the holder's secret is a **private witness** — consumed inside the ZK
  proof, never part of ledger state, never in the transaction payload;
- the chain stores only a **commitment** (a hash), so anyone can audit the
  registry while nobody — not even the issuer's on-chain footprint — can
  recover the secret or forge ownership;
- **rotation** is ZK access control: replacing a compromised secret requires
  proving knowledge of the current one, enforced inside the circuit;
- proofs are generated on the user's own machine (in the Lace wallet), so
  even the proof preimage never leaves the holder's device.

That combination — publicly auditable state, privately held data, and
prover-side privacy — is precisely what a credential registry needs and what
a transparent chain structurally cannot offer.

## Data Model

| Data Point            | Type            | Disclosed To |
|-----------------------|-----------------|--------------|
| `issuer`              | Public ledger   | Everyone     |
| `credentialId`        | Public ledger   | Everyone (deliberately disclosed via `disclose()`) |
| commitment = hash(`holderSecret`) | Public ledger | Everyone (irreversible without the secret) |
| `totalCredentials`    | Public ledger   | Everyone     |
| `totalRevoked`        | Public ledger   | Everyone     |
| `revoked` / `suspended` flags | Public ledger | Everyone |
| `holderSecret`        | Private witness | No one       |
| `newHolderSecret` (rotation) | Private witness | No one |

## Mainnet Feasibility

Yes — realistic to reach Mainnet by Level 6, with the risks named:

- **Architecture is done, not theoretical**: the same compiled contract is
  live and lifecycle-verified on preprod (register → rotate → suspend →
  reinstate → revoke, every transition indexer-verified). Mainnet is a
  network-id switch plus a funded deploy wallet, not a rewrite.
- **Toolchain is reproducible**: compiler pinned (compact `0.5.3` /
  `0.31.1`), compiles verified byte-deterministic; CI recompiles and re-runs
  the 18-test suite on every commit, so mainnet artifacts come from the
  exact audited source.
- **Costs are small and predictable**: one registry write per credential —
  a commitment plus status flags, no per-credential blobs, no per-verification
  chain interaction at all (verifiers read public state for free).
- **Named gaps, all operational**: Lace mainnet availability and mainnet
  token distribution; indexer uptime SLAs; issuer key management (an issuer
  identity is currently a field element — production needs a rotation story
  for compromised issuers); and the v1/v2 deployment lineage on preprod must
  collapse to a single mainnet deployment.

None of the remaining work touches the privacy model — the part that is
structurally impossible to retrofit on a transparent chain.
