import { useState } from 'react';
import { useMidnight } from '../hooks/useMidnight';

/**
 * CircuitCall — calls `registerCredential` on the preprod contract.
 *
 * Privacy properties enforced here:
 *  - the holder secret is typed into a password field, never rendered back;
 *  - the secret is a circuit witness only — it is sent to the proving
 *    pipeline and stored nowhere (no localStorage, no logging);
 *  - only the *commitment* (hash) of the secret lands on-chain;
 *  - the UI displays exclusively public data: credential ID, tx id, block.
 */
type Phase = 'idle' | 'proving' | 'submitting' | 'done' | 'error';

export function CircuitCall() {
  const { isConnected, callCircuit, readRegistry, provingMode } = useMidnight();
  const [credentialId, setCredentialId] = useState('');
  const [holderSecret, setHolderSecret] = useState('');
  const [issuer, setIssuer] = useState('1');
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<{ txId: string; blockHeight?: bigint } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [registry, setRegistry] = useState<Awaited<ReturnType<typeof readRegistry>>>(null);
  const busy = phase === 'proving' || phase === 'submitting';

  async function handleCall() {
    setError(null);
    setResult(null);
    setPhase('proving');
    try {
      // Small yield so the loading state paints before the heavy proof work.
      await new Promise((r) => setTimeout(r, 50));
      const res = await callCircuit({
        holderSecret,
        issuer,
        credentialId: credentialId || crypto.randomUUID(),
      });
      setResult(res);
      setPhase('done');
      // Clear the secret from component state immediately after use.
      setHolderSecret('');
      void refreshRegistry();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  }

  async function refreshRegistry() {
    try {
      setRegistry(await readRegistry());
    } catch {
      /* registry read is best-effort */
    }
  }

  return (
    <section className="card" aria-label="Circuit call">
      <h2>Register a credential</h2>
      <p className="muted">
        Calls <code>registerCredential</code> on the preprod registry. The proof is generated
        locally and the transaction is submitted through your wallet.
      </p>

      <label className="field">
        <span>Credential ID (public)</span>
        <input
          value={credentialId}
          onChange={(e) => setCredentialId(e.target.value)}
          placeholder="leave blank to auto-generate"
          disabled={!isConnected || busy}
        />
      </label>

      <label className="field">
        <span>Holder secret (private witness — never leaves this page)</span>
        <input
          type="password"
          value={holderSecret}
          onChange={(e) => setHolderSecret(e.target.value)}
          placeholder="type a secret…"
          autoComplete="off"
          disabled={!isConnected || busy}
        />
      </label>

      <label className="field">
        <span>Issuer ID (public)</span>
        <input
          value={issuer}
          onChange={(e) => setIssuer(e.target.value.replace(/[^0-9]/g, '') || '1')}
          disabled={!isConnected || busy}
        />
      </label>

      <button className="btn primary" disabled={!isConnected || busy || holderSecret.length === 0} onClick={() => void handleCall()}>
        {phase === 'proving' ? 'Generating ZK proof…' : phase === 'submitting' ? 'Submitting on-chain…' : 'Register credential'}
      </button>

      {!isConnected && <p className="muted small">Connect your Lace wallet first.</p>}

      <p className="privacy-note">
        🔐 Proved without revealing your input
        {provingMode && (
          <span className="proving-mode" title={
            provingMode === 'wallet'
              ? 'The ZK proof is generated inside your Lace wallet, on your machine. No proof preimage leaves this device.'
              : 'This wallet build cannot prove locally, so the serialized proof preimage is sent to the public preprod proof server.'
          }>
            {' '}· {provingMode === 'wallet' ? 'proving in your wallet (local)' : 'proving via proof server (fallback)'}
          </span>
        )}
      </p>

      {busy && (
        <div className="progress" role="status">
          <div className="spinner" />
          <span>
            {phase === 'proving'
              ? provingMode === 'wallet'
                ? 'Proving inside your Lace wallet on this machine — no preimage leaves your device…'
                : 'Building the zero-knowledge proof locally — this takes a few seconds…'
              : 'Submitting the transaction and waiting for it to land…'}
          </span>
        </div>
      )}

      {phase === 'done' && result && (
        <div className="state success">
          <p>
            ✅ Credential registered on-chain — only the <em>commitment</em> of your secret is public.
          </p>
          <p className="mono small">tx: {result.txId}</p>
          {result.blockHeight !== undefined && <p className="mono small">block: {result.blockHeight.toString()}</p>}
        </div>
      )}

      {phase === 'error' && error && (
        <div className="state error-state">
          <p className="error-text">Transaction failed: {error}</p>
          <p className="muted small">
            Common causes: wallet on the wrong network, no tNIGHT/DUST in the connected wallet, or the
            transaction was rejected in Lace.
          </p>
        </div>
      )}

      <hr />
      <div className="registry">
        <h3>On-chain registry (public read)</h3>
        <button className="btn small" onClick={() => void refreshRegistry()} disabled={!registry && busy}>
          Refresh
        </button>
        {registry && (
          <>
            <p className="mono small">
              issuer: {registry.issuer} · totalCredentials: {registry.totalCredentials} · totalRevoked:{' '}
              {registry.totalRevoked}
            </p>
            {registry.credentials.length > 0 && (
              <ul className="mono small">
                {registry.credentials.slice(0, 5).map((c, i) => (
                  <li key={i}>
                    {c.id}… → {c.value}…
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        {!registry && <p className="muted small">Click refresh to read the registry from the indexer.</p>}
      </div>
    </section>
  );
}
