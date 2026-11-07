---
name: node-backend
description: Workflow pentru backend-ul Node.js/Express MarketFixer (crawler, coadă de joburi, SQLite, API REST, upload CSV, comparare scanări).
---

# Node Backend (MarketFixer)

1. Citește `shared/CONTRACTS.md` (secțiunile 1, 3, 4).
2. Structura:
   - `src/server.js` (pornire) și `src/app.js` (Express app exportată, testabilă)
   - `src/routes/scans.js`
   - `src/crawler/` (fetch nativ + cheerio, robots.txt, sitemap.xml, BFS pe același origin, `maxPages`, timeout 10s/pagină, concurență 4, User-Agent `MarketFixerBot/0.1`, verificare HEAD pentru linkuri rupte, limitată)
   - `src/jobs/queue.js` (coadă in-memory, concurență 2, actualizează statusul și progresul în DB)
   - `src/db/index.js` (`node:sqlite`, `DatabaseSync`, fișier `backend/data/marketfixer.db`, tabele `scans` și `reports` cu raportul JSON)
   - `src/compare.js` (resolved / new / remaining după `fingerprint`)
3. Integrează analiza prin `import { analyzeSite } from "./analyzers/index.js"` și `import { analyzePerformance } from "./analyzers/performance.js"`.
4. Validează URL-ul (doar http/https). Blochează localhost și IP-urile private (protecție SSRF).
5. Teste cu `node --test`: crawler pe un server HTTP local de test, rutele API cu `fetch` pe app-ul pornit pe port 0.
