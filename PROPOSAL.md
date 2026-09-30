# Product Proposal

## What is the product, and who uses it?

ConfiCred is a zero-knowledge credential registry: issuers anchor tamper-proof
commitments to credentials on Midnight, and holders prove ownership of a
credential without ever revealing the secret behind it.

Who uses it:

- **Issuers** — universities, licensing boards, employers, membership
  organizations — enroll each credential once, on-chain, by submitting the
  holder's commitment.
- **Holders** — graduates, licensed professionals, employees, members — keep
  their secret locally and prove ownership (and rotate it if it leaks) at any
  time, from the dApp or their wallet.
- **Verifiers** — employers, regulators, border control, venues — audit that
  a credential exists, is active, and has not been revoked or suspended,
  without calling the issuer and without learning anything about the holder
  beyond what the holder chooses to show.

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

Yes — realistic to reach Mainnet by Level 6.

- **Architecture is done, not theoretical**: the same compiled contract is
  already live and lifecycle-verified on preprod (register → rotate →
  suspend → reinstate → revoke, each transition indexer-verified); targeting
  mainnet is a network-id switch plus a funded deploy wallet, not a rewrite.
- **Toolchain is reproducible**: compiles are pinned (compact `0.5.3` /
  compiler `0.31.1`) and verified deterministic; CI compiles and tests every
  commit, so mainnet artifacts come from the exact audited source.
- **Costs are small and predictable**: a credential is one registry write
  (a few ledger entries plus a proof); no per-credential on-chain blobs.
- **Known gaps are operational, not architectural**: Lace mainnet support and
  mainnet faucets/token distribution, indexer uptime SLAs, and an issuer
  onboarding flow (key management for the issuer identity) — all standard
  launch work, tracked and incremental.

None of the remaining work touches the privacy model, which is the part that
is genuinely hard to retrofit.
