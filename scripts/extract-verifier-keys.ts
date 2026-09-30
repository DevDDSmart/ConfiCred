/**
 * Extracts the deployed contract's verifier keys from the preprod indexer
 * so we can compare them against locally compiled keys byte-for-byte.
 *
 * Usage: npx tsx scripts/extract-verifier-keys.ts [--address <hex>]
 */
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { writeFileSync } from 'node:fs';

const ADDRESS =
  process.env.CONTRACT_ADDRESS ??
  '41a259a5c805adfc15885a02498c98b04acafd95bb0b0575398cffbe631b9989';

const provider = indexerPublicDataProvider(
  'https://indexer.preprod.midnight.network/api/v4/graphql',
  'wss://indexer.preprod.midnight.network/api/v4/graphql/ws',
);

const state = await provider.queryContractState(ADDRESS as `0x${string}`);
if (!state) {
  console.error('No contract state found at', ADDRESS);
  process.exit(1);
}

const keys: Record<string, string> = {};
// The ContractState exposes operations with their verifier keys.
for (const circuitId of ['registerCredential', 'revokeCredential']) {
  const op = state.operation(circuitId);
  keys[circuitId] = Buffer.from(op.verifierKey).toString('hex');
  console.log(circuitId, '→', keys[circuitId].slice(0, 32) + '…', `(${op.verifierKey.length} bytes)`);
}

writeFileSync('/tmp/onchain-vks.json', JSON.stringify(keys, null, 2));
console.log('written to /tmp/onchain-vks.json');
