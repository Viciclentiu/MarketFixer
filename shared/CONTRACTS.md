# MarketFixer — Contracte între module

Acest fișier este sursa de adevăr pentru interfața dintre **crawler/API** (`node-backend`) și **motorul de analiză** (`analysis-engine`). Orice schimbare de format se face aici întâi.

Toate modulele sunt ES Modules (`"type": "module"`), Node.js >= 22.13.

---

## 1. Ce produce crawler-ul → intrarea analizei

`backend/src/crawler/index.js` exportă:

```js
export async function crawlSite(rootUrl, { maxPages = 20, onProgress } = {}) // -> CrawlResult
```

```ts
type CrawlResult = {
  site: {
    rootUrl: string;            // URL normalizat (https://exemplu.ro/)
    origin: string;             // https://exemplu.ro
    robotsTxt: string | null;   // conținutul robots.txt sau null dacă lipsește
    sitemapUrls: string[];      // URL-uri găsite în sitemap.xml (poate fi gol)
    sitemapFound: boolean;
    brokenLinks: { url: string; status: number | null; foundOn: string; error?: string }[];
  };
  pages: Page[];
};

type Page = {
  url: string;                  // URL final (după redirect)
  requestedUrl: string;
  status: number;
  contentType: string | null;
  headers: Record<string, string>;
  html: string;                 // HTML brut (doar pentru text/html)
  depth: number;                // 0 = pagina de start
  loadMs: number;               // timpul până la primirea răspunsului complet
  sizeBytes: number;
  redirectChain: string[];
  links: { href: string; text: string; internal: boolean; nofollow: boolean }[];
  fetchedAt: string;            // ISO
};
```

## 2. Motorul de analiză

`backend/src/analyzers/index.js` exportă:

```js
export async function analyzeSite(crawlResult, { onProgress } = {}) // -> AnalysisResult
```

`backend/src/analyzers/performance.js` exportă:

```js
export function analyzePerformance(rows /* object[] din CSV */, { columns } = {}) // -> PerformanceResult
```

```ts
type AnalysisResult = {
  scores: { overall: number; seo: number; accessibility: number; ux: number; content: number }; // 0–100
  findings: Finding[];
  summary: {
    totalFindings: number;
    bySeverity: { critical: number; high: number; medium: number; low: number };
    byCategory: Record<Category, number>;
    topPriorities: string[];    // fingerprint-urile primelor 5 probleme
  };
  limitations: string[];        // ce NU a putut fi verificat (ex: JS randat, contrast în jsdom)
};

type Category = "seo" | "technical" | "accessibility" | "ux" | "content" | "ai_search";
type Severity = "critical" | "high" | "medium" | "low";

type Finding = {
  fingerprint: string;          // stabil între scanări: `${ruleId}|${pageUrl ?? "site"}|${detaliu-opțional}`
  ruleId: string;               // ex: "seo.title.missing"
  category: Category;
  severity: Severity;
  title: string;                // scurt, în română
  pageUrl: string | null;       // null = problemă la nivel de site
  affectedPages?: string[];     // pentru probleme agregate (ex: titlu duplicat)
  evidence: {                   // OBLIGATORIU — dovada concretă
    summary: string;            // ex: "Pagina are 3 elemente <h1>"
    snippet?: string;           // fragment HTML/text, max ~300 caractere
    value?: number | string;    // ex: 182 (lungimea titlului)
    expected?: string;          // ex: "30–60 caractere"
  };
  whyItMatters: string;         // de ce contează, în română
  recommendation: string;       // schimbare concretă, în română
  effort: "low" | "medium" | "high";
  source: "rule" | "axe-core" | "llm";
};

type PerformanceResult = {
  rowCount: number;
  columnsDetected: { dimensions: string[]; metrics: string[] };
  insights: {
    statement: string;          // afirmație susținută de date, cu cifre
    evidence: { metric: string; groups: { name: string; n: number; mean: number; total: number }[] };
    confidence: "low" | "medium" | "high"; // "low" dacă n < 5 per grup
    caveat?: string;            // ex: "Eșantion mic (n=3), nu generaliza"
  }[];
  warnings: string[];
};
```

## 3. Raportul salvat (ce returnează API-ul)

```ts
type Report = AnalysisResult & {
  scanId: string;
  url: string;
  generatedAt: string;
  pagesAnalyzed: number;
  performance?: PerformanceResult;  // atașat după upload CSV
};
```

## 4. API REST (`node-backend`)

| Metodă | Rută | Răspuns |
|---|---|---|
| POST | `/api/scans` body `{ url, maxPages? }` | `202 { scanId, status }` |
| GET | `/api/scans/:id` | `{ scanId, url, status, progress: { phase, done, total }, createdAt, finishedAt, error? }` |
| GET | `/api/scans/:id/report` | `Report` (404 dacă nu e gata) |
| GET | `/api/scans?url=` | listă scanări (istoric), cele mai noi primele |
| GET | `/api/scans/:id/compare/:prevId` | `{ resolved: Finding[], new: Finding[], remaining: Finding[], scoreDelta: {...} }` (comparare după `fingerprint`) |
| POST | `/api/scans/:id/performance` multipart `file` (CSV) | `PerformanceResult` (salvat și în raport) |
| GET | `/api/health` | `{ status: "ok" }` |

Status: `queued → crawling → analyzing → done | failed`.

## Principiu de produs

MarketFixer este un **analizator care oferă recomandări motivate**. Nicio constatare fără `evidence`. Nicio afirmație despre public fără date de performanță, iar acelea includ mărimea eșantionului.
