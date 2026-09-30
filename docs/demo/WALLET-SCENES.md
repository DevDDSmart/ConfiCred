# Demo video — what to record with the real Lace wallet

The automated draft (`conficred-demo.mp4`) shows the complete dApp flow with a
simulated wallet. For the submission, you can optionally re-record the two
wallet-bound moments with the real extension — everything else is already in
the draft.

## Setup

1. Open https://frontend-chi-sandy-60.vercel.app in Chrome with **Lace**
   installed and set to the **Midnight preprod** network.
2. Start a screen recording (OBS, QuickTime, or the OS built-in recorder).
   Keep the recording under **2 minutes** total.

## Shot list (matches the README checklist)

1. **Connect (0:00–0:20)** — click *Connect Lace*, approve inside the Lace
   popup, and let the connected address appear on screen. Point at it.
2. **Circuit call (0:20–1:00)** — type the holder secret (it stays masked),
   click *Register credential*, and let the *Proving inside your Lace wallet*
   state play. Approve the transaction in Lace when it pops up.
3. **On-chain result (1:00–1:30)** — the success panel shows the tx id /
   block; the *On-chain registry* read-back below shows `totalCredentials`
   go up.
4. **Privacy point (1:30–2:00)** — show the masked input again, then the
   *🔐 Proved without revealing your input* label and the registry's
   hash-only entries. Say it out loud: the secret was never displayed, never
   left the page.

## Editing notes

- The draft cut `conficred-demo.mp4` (scene A→D) can be used as-is, or the
  two real-Lace shots above can replace scenes A and B in an editor.
- Scene files are timestamped and independent; regenerate them any time with
  `node /tmp/vidtools/record-final.mjs` (dev-only tool, not part of the app).
