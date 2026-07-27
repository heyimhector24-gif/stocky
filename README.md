# Stocky

## What this is
- `index.html` — the marketing page + dashboard, all in plain HTML/JS (no framework dependency)
- `api/stocky.js` — hidden backend function. Handles live price/overlap/recovery lookups and the Ask Stocky chat. This is the only place your API key lives.

## Deploy on Vercel

1. Push this whole folder to a GitHub repository.
2. Go to vercel.com, sign in with GitHub, "Add New Project," select this repo.
3. Before deploying, expand "Environment Variables" and add:
   - Key: `ANTHROPIC_API_KEY`
   - Value: your key from console.anthropic.com (starts with `sk-ant-`)
4. Deploy. You'll get a live URL like `your-project.vercel.app`.

If you already deployed the shop-floor extractor, you can reuse the same API key here — just add it as an environment variable on this new project too.

## Test after deploy
Open the live URL in an incognito window, click "Open Dashboard," log a transaction, click "Refresh live data," and try asking Ask Stocky a question. Refresh the page to confirm your transactions persisted.
