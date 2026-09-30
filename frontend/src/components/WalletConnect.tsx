import { useEffect, useState } from 'react';
import { useMidnight } from '../hooks/useMidnight';

/**
 * WalletConnect — Lace wallet connect/disconnect UI.
 *
 * Handles: wallet not installed, user rejected the connection request,
 * network mismatch (Lace surfaces it during connect), and the connected /
 * disconnected states with the unshielded address shown when connected.
 */
export function WalletConnect() {
  const { wallet, connect, disconnect } = useMidnight();
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    if (wallet.status === 'connected') setHint(null);
  }, [wallet.status]);

  return (
    <section className="card" aria-label="Wallet connection">
      <h2>Wallet</h2>

      {wallet.status === 'checking' && <p className="muted">Detecting Lace wallet…</p>}

      {wallet.status === 'not-installed' && (
        <div className="state error-state">
          <p>
            <strong>Lace wallet not detected.</strong>
          </p>
          <p className="muted">
            Install the{' '}
            <a href="https://lace.io/" target="_blank" rel="noreferrer">
              Lace browser extension
            </a>
            , make sure it is set to the <strong>Midnight network</strong>, then reload this page.
          </p>
          <button className="btn" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      )}

      {wallet.status === 'disconnected' && (
        <div className="state">
          <p className="muted">No wallet connected.</p>
          <button className="btn primary" onClick={() => void connect()}>
            Connect Lace
          </button>
          {(wallet.error || hint) && <p className="error-text">{wallet.error ?? hint}</p>}
        </div>
      )}

      {wallet.status === 'connecting' && (
        <div className="state">
          <p className="muted">Waiting for approval in {wallet.walletName ?? 'Lace'}…</p>
          <p className="muted small">
            If a network mismatch is shown, switch the wallet to the <strong>preprod</strong> network and try again.
          </p>
        </div>
      )}

      {wallet.status === 'connected' && (
        <div className="state connected">
          <p>
            <span className="dot" /> Connected via {wallet.walletName ?? 'Lace'}
          </p>
          <p className="address mono" title={wallet.address}>
            {wallet.address}
          </p>
          <button className="btn" onClick={disconnect}>
            Disconnect
          </button>
        </div>
      )}

      {wallet.status === 'error' && (
        <div className="state error-state">
          <p className="error-text">{wallet.error}</p>
          <button className="btn" onClick={() => void connect()}>
            Try again
          </button>
        </div>
      )}
    </section>
  );
}
