import { WalletConnect } from './components/WalletConnect';
import { CircuitCall } from './components/CircuitCall';

export default function App() {
  return (
    <main className="app">
      <header>
        <h1>ConfiCred</h1>
        <p className="muted">
          Zero-knowledge credential registry on Midnight · preprod
        </p>
        <p className="mono small contract-addr">
          contract: 40919146318915fd52397826f35d3ba9933d64fdbeb173485f73e011f1b428f0
        </p>
      </header>
      <WalletConnect />
      <CircuitCall />
      <footer className="muted small">
        Your secret is a ZK witness only: it is typed here, proved locally, and never shown,
        stored, or put on-chain. 🔐 Proved without revealing your input.
      </footer>
    </main>
  );
}
