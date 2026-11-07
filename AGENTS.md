# MarketFixer: instrucțiuni pentru agenți

MarketFixer analizează site-ul public al unei afaceri (SEO, tehnic, accesibilitate, UX, conținut) și oferă un raport prioritizat, cu recomandări motivate prin dovezi.

**Stack:** React + SCSS (`frontend/`), Node.js + Express (`backend/`), SQLite prin `node:sqlite` (Node >= 22.13), ES Modules.

**Contractul dintre module:** [`shared/CONTRACTS.md`](shared/CONTRACTS.md). Citește-l înainte de orice modificare.

## Roluri

### `analysis-engine`
- Lucrează în `backend/src/analyzers/` și `backend/test/analyzers/`.
- Implementează `analyzeSite(crawlResult)` și `analyzePerformance(rows)` exact conform contractului.
- Reguli: SEO tehnic, accesibilitate (axe-core pe jsdom), UX/navigare, conținut (lizibilitate, repetiții, limbaj generic), pregătire pentru AI search, plus analiza CSV de performanță.
- LLM opțional: doar dacă există `GEMINI_API_KEY`. Fără cheie, analiza merge complet pe reguli.

### `node-backend`
- Lucrează în `backend/src/` (fără `analyzers/`) și `backend/test/`.
- Express API, crawler (fetch + cheerio, respectă robots.txt, același domeniu, limită de pagini, timeout-uri), coadă de joburi in-memory, stocare SQLite, upload CSV, comparare între scanări.

## Reguli comune
1. Fiecare `Finding` are `evidence`. Fără dovadă, nu există constatare.
2. Textele pentru utilizator (`title`, `whyItMatters`, `recommendation`) sunt în română.
3. Nu modifica fișierele celuilalt agent. Dacă ai nevoie de o schimbare de contract, actualizează `shared/CONTRACTS.md` și menționează asta în raportul tău.
4. Fără căi absolute în cod. Fără secrete în repo: folosește `.env` (ignorat de git).
5. Teste cu `node --test` (runner-ul nativ), fără framework-uri suplimentare.
