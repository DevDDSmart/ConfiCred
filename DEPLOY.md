# ConfiCred frontend — Vercel deployment

## One-time setup

```bash
npm install -g vercel
vercel login          # or use a token, see below
```

## Deploy

From the **repo root**:

```bash
cd frontend
vercel --prod --yes
```

The first run links the directory to a Vercel project (accept the detected
Vite settings); subsequent runs redeploy straight through.

### Token-based (non-interactive)

```bash
cd frontend
vercel --prod --yes --token "$VERCEL_TOKEN"
```

The deployment automatically:

- runs `npm run build` (vite build — TS typecheck + bundle)
- serves `dist/` with SPA rewrites (`vercel.json`)
- serves `/zk/*` — the compact-compile artifacts the dApp fetches at runtime

## After deploying

1. Copy the printed `https://<project>.vercel.app` URL.
2. Paste it into the `## Live Demo` section of the root `README.md`.
3. Open the URL, install/enable the Lace extension on the Midnight preprod
   network, connect, and register a credential.
