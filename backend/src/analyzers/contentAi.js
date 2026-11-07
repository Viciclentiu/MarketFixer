// Analiza de conținut și comunicare de marketing cu LLM (Gemini / OpenAI).
//
// Ce evaluează (lucruri pe care Lighthouse și regulile statice NU le pot judeca):
//   - claritatea propunerii de valoare și a publicului țintă
//   - forța CTA-ului
//   - prezența dovezilor sociale
//   - afirmații vagi și formulări ambigue (cu rescriere propusă)
//   - dacă un asistent AI poate extrage faptele de bază (servicii, prețuri, locație, contact)
//
// Garanția anti-halucinație: orice citat returnat de model este verificat că există
// textual în pagină. Constatările cu citate inexistente sunt eliminate și numărate.
import { generateJson, resolveApiKey } from '../ai/llm.js';
import { extractText, finding, fold, htmlPages, isHomePage, load, normalizeSpace, truncate, words } from './utils.js';

const MAX_TEXT_CHARS = 6000;
const SOCIAL_PROOF_RE =
  /(testimonial|recenzi|review|clien[tț]i (no[sș]tri|mul[tț]umi[tț]i)|studi[ui] de caz|case stud|\d+\s*(\+\s*)?(de\s+)?(clien[tț]i|proiecte|ani de experien|companii|customers|projects)|★|stele|trusted by|partener)/i;

function canon(s) {
  return fold(s).replace(/[„”"'’`«»]/g, '').replace(/\s+/g, ' ').trim();
}

function quoteInText(quote, canonText) {
  const q = canon(quote);
  return q.length >= 4 && canonText.includes(q);
}

function excerptOf($) {
  const h1 = normalizeSpace($('h1').first().text());
  const p = normalizeSpace($('main p, p').first().text());
  return truncate([h1, p].filter(Boolean).join(' — '), 280) || undefined;
}

function buttonTexts($) {
  const texts = [];
  $('button, a.btn, a.button, a[class*="cta"], a[role="button"], input[type="submit"]').each((_, el) => {
    const t = normalizeSpace($(el).text() || $(el).attr('value') || '');
    if (t && !texts.includes(t)) texts.push(t);
  });
  return texts.slice(0, 6);
}

function buildPrompt(url, text) {
  return `Ești un consultant senior de marketing și copywriting. Evaluezi textul unei pagini web (${url}).
Reguli stricte:
- Orice câmp "quote" trebuie să fie un fragment COPIAT EXACT, caracter cu caracter, din textul de mai jos (3–25 cuvinte). Dacă nu ai un citat exact, lasă "quote" gol.
- Nu inventa fapte despre afacere. Judecă doar ce scrie în text.
- Câmpurile "issue", "why", "suggestion", "rewrite" sunt în limba română. Citatele rămân în limba originală.

Returnează STRICT JSON cu forma:
{
  "valueProposition": { "score": 0-10, "quote": "", "issue": "", "suggestion": "" },
  "targetAudience": { "identifiable": true, "quote": "", "issue": "", "suggestion": "" },
  "cta": { "present": true, "strength": 0-10, "quote": "", "issue": "", "suggestion": "" },
  "socialProof": { "present": true, "quote": "", "suggestion": "" },
  "vagueClaims": [ { "quote": "", "why": "", "rewrite": "" } ],
  "ambiguities": [ { "quote": "", "why": "", "rewrite": "" } ],
  "aiFacts": { "services": true, "prices": true, "location": true, "contact": true, "suggestion": "" }
}
Maxim 5 elemente în vagueClaims și 3 în ambiguities.

TEXTUL PAGINII:
"""
${text}
"""`;
}

function pageFindings(page, crawlResult, data, stats) {
  const $ = load(page);
  const url = page.url;
  const home = isHomePage(page, crawlResult);
  const pageText = extractText($, { main: false });
  const canonText = canon(pageText);
  const out = [];

  const verified = (quote) => {
    if (!quote) return null;
    if (quoteInText(quote, canonText)) return truncate(normalizeSpace(quote), 300);
    stats.droppedUnverified += 1;
    return null;
  };

  // 1. Propunerea de valoare
  const vp = data.valueProposition ?? {};
  if (typeof vp.score === 'number' && vp.score < 6) {
    const quote = verified(vp.quote);
    out.push(
      finding({
        ruleId: 'content.ai.value_proposition_unclear',
        category: 'content',
        severity: home ? 'high' : 'medium',
        pageUrl: url,
        title: 'Propunerea de valoare nu este clară',
        evidence: {
          summary: `Evaluare AI: claritatea mesajului principal ${vp.score}/10${vp.issue ? `. ${vp.issue}` : ''}`,
          snippet: quote ?? excerptOf($),
          value: vp.score,
          expected: 'un vizitator înțelege în 5 secunde ce oferi, cui și de ce ești diferit (≥ 6/10)',
        },
        whyItMatters:
          'Dacă vizitatorul nu înțelege imediat ce oferi și de ce e relevant pentru el, pleacă. Asistenții AI au aceeași problemă când încearcă să te descrie.',
        recommendation:
          vp.suggestion ||
          'Rescrie titlul principal ca să spună concret ce oferi, pentru cine și ce rezultat obține clientul.',
        effort: 'low',
        source: 'llm',
      }),
    );
  }

  // 2. Publicul țintă
  const ta = data.targetAudience ?? {};
  if (ta.identifiable === false) {
    out.push(
      finding({
        ruleId: 'content.ai.audience_unclear',
        category: 'content',
        severity: 'medium',
        pageUrl: url,
        title: 'Nu reiese cui se adresează oferta',
        evidence: {
          summary: `Evaluare AI: publicul țintă nu poate fi identificat din text${ta.issue ? `. ${ta.issue}` : ''}`,
          snippet: verified(ta.quote) ?? excerptOf($),
        },
        whyItMatters:
          'Clienții se recunosc în mesajele scrise pentru ei. Un text pentru „toată lumea” convinge pe nimeni și se potrivește greu cu întrebările adresate asistenților AI.',
        recommendation:
          ta.suggestion || 'Numește explicit segmentul de clienți (ex: „pentru clinici stomatologice din Cluj”).',
        effort: 'low',
        source: 'llm',
      }),
    );
  }

  // 3. CTA slab (doar când există un CTA citat verificabil; lipsa lui e acoperită de ux.cta.missing_on_home)
  const cta = data.cta ?? {};
  if (cta.present && typeof cta.strength === 'number' && cta.strength < 6) {
    const quote = verified(cta.quote);
    if (quote) {
      out.push(
        finding({
          ruleId: 'content.ai.cta_weak',
          category: 'ux',
          severity: home ? 'medium' : 'low',
          pageUrl: url,
          detail: quote.slice(0, 60),
          title: 'Îndemnul la acțiune (CTA) este slab',
          evidence: {
            summary: `Evaluare AI: forța CTA ${cta.strength}/10${cta.issue ? `. ${cta.issue}` : ''}`,
            snippet: quote,
            value: cta.strength,
            expected: 'CTA specific, orientat pe beneficiu (≥ 6/10)',
          },
          whyItMatters:
            'CTA-ul este momentul în care vizitatorul devine client. Formulări generice („Trimite”, „Află mai mult”) convertesc vizibil mai slab decât cele specifice.',
          recommendation: cta.suggestion || 'Folosește un verb de acțiune + beneficiul (ex: „Primește oferta în 24h”).',
          effort: 'low',
          source: 'llm',
        }),
      );
    }
  }

  // 4. Dovezi sociale (doar pe homepage; verificăm mecanic că într-adevăr lipsesc)
  const sp = data.socialProof ?? {};
  if (home && sp.present === false && !SOCIAL_PROOF_RE.test(pageText)) {
    out.push(
      finding({
        ruleId: 'content.ai.social_proof_missing',
        category: 'content',
        severity: 'medium',
        pageUrl: url,
        title: 'Lipsesc dovezile sociale (testimoniale, cifre, clienți)',
        evidence: {
          summary:
            'Nu am găsit pe pagina principală testimoniale, recenzii, studii de caz sau cifre despre clienți (evaluare AI confirmată prin căutare după cuvinte-cheie).',
          snippet: excerptOf($),
        },
        whyItMatters:
          'Vizitatorii noi au nevoie de dovezi că alții au avut încredere în tine. Fără ele, afirmațiile despre calitate rămân nesusținute.',
        recommendation:
          sp.suggestion ||
          'Adaugă 2–3 testimoniale reale (nume, firmă), numărul de clienți/proiecte sau logo-urile clienților, cu acordul lor.',
        effort: 'medium',
        source: 'llm',
      }),
    );
  }

  // 5. Afirmații vagi și 6. formulări ambigue (doar cu citat verificat)
  const lists = [
    ['vagueClaims', 'content.ai.vague_claim', 'Afirmație vagă, fără dovezi', 'low', 5],
    ['ambiguities', 'content.ai.ambiguous', 'Formulare ambiguă sau greu de înțeles', 'low', 3],
  ];
  for (const [key, ruleId, title, severity, max] of lists) {
    for (const item of (Array.isArray(data[key]) ? data[key] : []).slice(0, max)) {
      const quote = verified(item?.quote);
      if (!quote) continue;
      out.push(
        finding({
          ruleId,
          category: 'content',
          severity,
          pageUrl: url,
          detail: quote.slice(0, 80),
          title,
          evidence: { summary: item.why || 'Evaluare AI', snippet: quote },
          whyItMatters:
            'Formulările vagi sau ambigue nu le spun clienților (și nici motoarelor AI) nimic verificabil despre ce primesc.',
          recommendation: item.rewrite
            ? `Variantă propusă (AI): „${item.rewrite}”. Verifică faptele înainte de publicare.`
            : 'Înlocuiește formularea cu un fapt concret și verificabil.',
          effort: 'low',
          source: 'llm',
        }),
      );
    }
  }

  // 7. Faptele de bază pentru asistenții AI (doar homepage)
  const facts = data.aiFacts ?? {};
  const labels = { services: 'serviciile/produsele', prices: 'prețurile', location: 'locația', contact: 'datele de contact' };
  const missing = Object.keys(labels).filter((k) => facts[k] === false);
  if (home && missing.length >= 2) {
    out.push(
      finding({
        ruleId: 'ai_search.ai.facts_missing',
        category: 'ai_search',
        severity: missing.length >= 3 ? 'high' : 'medium',
        pageUrl: url,
        title: 'Un asistent AI nu poate extrage faptele de bază despre afacere',
        evidence: {
          summary: `Evaluare AI: din textul paginii nu reies ${missing.map((k) => labels[k]).join(', ')}`,
          snippet: excerptOf($),
          value: missing.length,
          expected: 'servicii, prețuri (sau interval), locație și contact menționate explicit',
        },
        whyItMatters:
          'Când un client întreabă ChatGPT, Gemini sau Perplexity „ce firmă îmi recomanzi pentru X”, asistentul folosește doar fapte explicite din pagină.',
        recommendation:
          facts.suggestion ||
          'Adaugă o secțiune scurtă cu fapte: ce servicii oferi, interval de prețuri, zona deservită și contact.',
        effort: 'medium',
        source: 'llm',
      }),
    );
  }

  return out;
}

/**
 * @returns {Promise<{ findings: object[], stats: object, limitation: string|null }>}
 */
export async function runContentAi(crawlResult, { apiKey, maxPages = 3, generate = generateJson } = {}) {
  const stats = { pagesAnalyzed: 0, droppedUnverified: 0, provider: null, errors: [] };
  if (!resolveApiKey(apiKey) && generate === generateJson) {
    return {
      findings: [],
      stats,
      limitation: 'Analiza AI de conținut nu a rulat: nu este configurată nicio cheie (GEMINI_API_KEY / OPENAI_API_KEY).',
    };
  }

  const pages = htmlPages(crawlResult);
  const home = pages.find((p) => isHomePage(p, crawlResult)) ?? pages[0];
  const others = pages
    .filter((p) => p !== home)
    .map((p) => ({ p, wc: words(extractText(load(p), { main: true })).length }))
    .sort((a, b) => b.wc - a.wc)
    .map((x) => x.p);
  const selected = [home, ...others].filter(Boolean).slice(0, maxPages);

  const results = await Promise.all(
    selected.map(async (page) => {
      const text = extractText(load(page), { main: false }).slice(0, MAX_TEXT_CHARS);
      if (words(text).length < 20) return [];
      try {
        const { data, provider } = await generate({ prompt: buildPrompt(page.url, text), apiKey });
        stats.provider = provider;
        stats.pagesAnalyzed += 1;
        return pageFindings(page, crawlResult, data ?? {}, stats);
      } catch (err) {
        stats.errors.push(`${page.url}: ${err?.message || err}`);
        return [];
      }
    }),
  );

  const findings = results.flat();
  let limitation = null;
  if (stats.pagesAnalyzed > 0) {
    limitation = `Analiza AI de conținut (${stats.provider}) a rulat pe ${stats.pagesAnalyzed} pagini. Evaluările sunt marcate cu sursa „llm”${
      stats.droppedUnverified ? `; ${stats.droppedUnverified} afirmații ale modelului fără citat verificabil în pagină au fost eliminate` : ''
    }.`;
  } else if (stats.errors.length) {
    limitation = `Analiza AI de conținut a eșuat: ${stats.errors[0]}`;
  }
  return { findings, stats, limitation };
}
