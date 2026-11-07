---
name: analysis-engine
description: Workflow pentru motorul de analiză MarketFixer (reguli SEO, tehnice, accesibilitate, UX, conținut, AI search și analiza CSV de performanță) din backend/src/analyzers.
---

# Analysis Engine (MarketFixer)

1. Citește `shared/CONTRACTS.md` (tipurile `CrawlResult`, `Finding`, `AnalysisResult`, `PerformanceResult`).
2. Fiecare categorie are un modul separat în `backend/src/analyzers/` (`seo.js`, `technical.js`, `accessibility.js`, `ux.js`, `content.js`, `aiSearch.js`) care exportă `run(crawlResult) -> Finding[]`.
3. `index.js` rulează modulele, deduplică după `fingerprint`, calculează scorurile și sortează după severitate, apoi după efort (impact mare + efort mic primele).
4. Scor pe categorie: pornește de la 100 și scade penalizări pe severitate (critical 25, high 10, medium 4, low 1), cu limită la 0. `overall` = medie ponderată (seo 25%, technical 20%, accessibility 20%, content 20%, ux 10%, ai_search 5%). Technical intră doar în overall, nu are câmp separat în `scores`. Dacă îl expui, actualizează contractul.
5. Testează fiecare regulă cu fixture-uri HTML în `backend/test/analyzers/` (`node --test`).
6. Analiza de performanță: detectează automat coloanele numerice (metrici) și pe cele text (dimensiuni), grupează și compară mediile. Confidence `low` dacă n < 5 per grup. Nu formula concluzii despre „ce îi place publicului”, ci doar comparații observate.
