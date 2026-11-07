# MarketFixer — Backend (`node-backend`)

API REST Node.js/Express pentru scanarea site-urilor publice, gestionarea cozii de analiză, stocarea rapoartelor în SQLite (`node:sqlite`), compararea între scanări și atașarea datelor CSV de performanță.

## Cerințe

- **Node.js >= 22.13** (pentru modulul nativ `node:sqlite` și `node --test`).

## Pornire

```bash
npm install
npm run dev     # pornește cu --watch pe http://localhost:4000
npm start       # pornește producție pe PORT || 4000
npm test        # rulează suita de teste cu node --test
```

## Rute API (`/api`)

| Metodă | Rută | Descriere |
|---|---|---|
| `GET` | `/api/health` | Verificare stare (`{ status: "ok" }`) |
| `POST` | `/api/scans` | Pornește o scanare asincronă (`{ url, maxPages? }`) → `202 { scanId, status }` |
| `GET` | `/api/scans/:id` | Starea și progresul unei scanări (`queued → crawling → analyzing → done \| failed`) |
| `GET` | `/api/scans/:id/report` | Raportul complet al scanării (`Report`, `404` dacă nu e gata) |
| `GET` | `/api/scans?url=` | Istoricul scanărilor (cele mai noi primele) |
| `GET` | `/api/scans/:id/compare/:prevId` | Comparare între două scanări după `fingerprint` (`{ resolved, new, remaining, scoreDelta }`) |
| `POST` | `/api/scans/:id/performance` | Upload CSV (`multipart/form-data`, câmp `file`) → `PerformanceResult` (atașat și la raport) |

## Securitate și Limite Crawler

- Acceptă exclusiv schemele `http:` și `https:`.
- Protecție SSRF completă (inclusiv la redirecționări și DNS rebinding): blochează `localhost`, loopback (`127.0.0.0/8`, `::1`), rețele private RFC1918 (`10/8`, `172.16/12`, `192.168/16`), link-local/cloud metadata (`169.254.0.0/16`, `fe80::/10`).
- Respectă directivele din `robots.txt` pentru `MarketFixerBot` / `*`.
- Timeout de 10s/pagină, limită de 3 MB/răspuns HTML, maxim 50 pagini/scanare.
