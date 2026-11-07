// Punctul de pornire al serverului HTTP MarketFixer.
import { createApp } from './app.js';

const port = Number(process.env.PORT) || 4000;
const app = createApp();

const server = app.listen(port, () => {
  console.log(`MarketFixer API pornit pe http://localhost:${port}`);
});

function shutdown() {
  server.close(() => {
    app.locals.db?.close?.();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
