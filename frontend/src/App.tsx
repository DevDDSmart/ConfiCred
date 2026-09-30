import { CONTRACT_ADDRESS } from './contract/registry';
import { MidnightProvider } from './hooks/useMidnight';
import { WalletConnect } from './components/WalletConnect';
import { CircuitCall } from './components/CircuitCall';

export default function App() {
  return (
    <MidnightProvider>
      <main className="app">
      <header>
        <h1>ConfiCred</h1>
        <p className="muted">
          Zero-knowledge credential registry on Midnight · preprod
        </p>
        <p className="mono small contract-addr">contract: {CONTRACT_ADDRESS}</p>
      </header>
      <WalletConnect />
      <CircuitCall />
      <footer className="muted small">
        Your secret is a ZK witness only: it is typed here, proved locally, and never shown,
        stored, or put on-chain. 🔐 Proved without revealing your input.
      </footer>
      </main>
    </MidnightProvider>
  );
}
