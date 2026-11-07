# MarketFixer

## Vercel

The root `vercel.json` deploys the Vite frontend as the public catch-all service and routes `/api/*` to the Express backend. The frontend calls the API through same-origin `/api` URLs, so no service binding is needed.

The backend currently uses an in-memory job queue and local SQLite storage. Those are not durable across Vercel Function instances or deployments; use a durable database and job queue before relying on scan processing in production.
