// Integrare SerpApi (Google Search + People Also Ask + AI Overview) pentru analiza
// de vizibilitate și conținut: verifică cum apare afacerea în Google și ce întrebări
// reale caută publicul ("People Also Ask") pe tema paginii.
import { finding, findHomePage, load, normalizeSpace, truncate } from './utils.js';

export async function runSerpAnalysis(crawlResult, { serpApiKey } = {}) {
  const key = String(serpApiKey || process.env.SERPAPI_KEY || '').trim();
  if (!key) {
    return { findings: [], serpData: null, limitation: null };
  }

  const home = findHomePage(crawlResult);
  if (!home) return { findings: [], serpData: null, limitation: null };

  const $ = load(home);
  const url = home.url;
  const hostname = new URL(url).hostname.replace(/^www\./, '');
  const titleText = normalizeSpace($('head title').first().text());
  const h1Text = normalizeSpace($('h1').first().text());
  const query = h1Text || titleText || hostname;

  try {
    const endpoint = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(
      query,
    )}&hl=ro&gl=ro&api_key=${encodeURIComponent(key)}`;

    const res = await fetch(endpoint, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) {
      return {
        findings: [],
        serpData: null,
        limitation: `SerpApi a răspuns cu status ${res.status}.`,
      };
    }

    const data = await res.json();
    const organic = Array.isArray(data.organic_results) ? data.organic_results : [];
    const relatedQuestions = Array.isArray(data.related_questions)
      ? data.related_questions.map((q) => q.question).filter(Boolean)
      : [];

    const ownResult = organic.find((r) => {
      try {
        return new URL(r.link).hostname.replace(/^www\./, '') === hostname;
      } catch {
        return false;
      }
    });

    const findings = [];

    if (!ownResult) {
      const topCompetitors = organic
        .slice(0, 3)
        .map((r) => `${r.title} (${r.link})`)
        .join('; ');
      findings.push(
        finding({
          ruleId: 'seo.serp.not_in_top_results',
          category: 'seo',
          severity: 'high',
          pageUrl: url,
          title: 'Site-ul nu apare în primele rezultate Google pe subiectul principal al paginii',
          evidence: {
            summary: `La căutarea Google după „${truncate(query, 80)}” (via SerpApi), domeniul ${hostname} nu apare în primele ${organic.length || 10} rezultate organice.`,
            snippet: topCompetitors ? `Primele rezultate actuale: ${truncate(topCompetitors, 260)}` : undefined,
            value: 0,
            expected: 'prezență în Top 10 rezultate Google pe subiectul principal',
          },
          whyItMatters:
            'Dacă potențialii clienți caută tema principală din H1/Title pe Google și ajung doar la competitori, pierzi traficul cu intenție directă de cumpărare.',
          recommendation:
            'Aliniază <title> și <h1> cu expresiile exacte căutate de clienți și răspunde în pagină la întrebările din secțiunea „People Also Ask” de pe Google.',
          effort: 'medium',
          source: 'rule',
        }),
      );
    }

    if (relatedQuestions.length > 0) {
      const pageTextLower = $.text().toLowerCase();
      const unanswered = relatedQuestions.filter(
        (q) => !pageTextLower.includes(q.toLowerCase().slice(0, 20)),
      );
      if (unanswered.length > 0) {
        findings.push(
          finding({
            ruleId: 'content.serp.missing_paa_questions',
            category: 'content',
            severity: 'medium',
            pageUrl: url,
            title: 'Conținutul nu răspunde la întrebările reale căutate pe Google (People Also Ask)',
            evidence: {
              summary: `SerpApi a identificat ${unanswered.length} întrebări frecvente căutate pe Google pentru „${truncate(query, 60)}” care nu au răspuns pe pagină`,
              snippet: truncate(unanswered.slice(0, 4).join(' | '), 280),
              value: unanswered.length,
              expected: 'secțiune FAQ care răspunde direct la întrebările din Google',
            },
            whyItMatters:
              'Răspunsurile directe la întrebările din „People Also Ask” cresc șansele de apariție în Google AI Overviews și în răspunsurile ChatGPT/Perplexity.',
            recommendation: `Adaugă pe pagină o secțiune FAQ cu răspunsuri scurte (40–60 cuvinte) la aceste întrebări: ${unanswered
              .slice(0, 3)
              .map((q) => `„${q}”`)
              .join(', ')}.`,
            effort: 'low',
            source: 'rule',
          }),
        );
      }
    }

    return {
      findings,
      serpData: {
        query,
        inTop10: Boolean(ownResult),
        position: ownResult?.position ?? null,
        relatedQuestions: relatedQuestions.slice(0, 5),
      },
      limitation: `SerpApi a verificat prezența în Google Search pentru interogarea „${truncate(query, 60)}”.`,
    };
  } catch (err) {
    return {
      findings: [],
      serpData: null,
      limitation: `Verificarea SerpApi nu a putut fi finalizată: ${err?.message || err}`,
    };
  }
}
