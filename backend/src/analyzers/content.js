// Reguli de analiză a conținutului: lizibilitate (lungimea frazelor),
// paragrafe foarte lungi, conținut subțire, blocuri de text repetate între pagini
// și clișee / expresii generice de marketing.
import { extractText, finding, fold, htmlPages, load, normalizeSpace, truncate, words } from './utils.js';

export const MIN_WORD_COUNT = 250;
export const MAX_AVG_SENTENCE_WORDS = 25;
export const MAX_PARAGRAPH_WORDS = 120;
export const MIN_DUPLICATE_BLOCK_WORDS = 15;

const C = 'content';

const GENERIC_PHRASES = [
  'solutii inovatoare',
  'solutii personalizate',
  'solutii la cheie',
  'lider pe piata',
  'lideri pe piata',
  'lider de piata',
  'calitate superioara',
  'cea mai inalta calitate',
  'cel mai bun raport calitate-pret',
  'raport calitate pret imbatabil',
  'servicii complete',
  'gama completa de servicii',
  'echipa tanara si dinamica',
  'echipa de profesionisti',
  'profesionalism si seriozitate',
  'seriozitate si promptitudine',
  'orientat catre client',
  'orientati catre client',
  'satisfactia clientilor nostri',
  'experienta vasta in domeniu',
  'pasiune pentru excelenta',
  'standarde inalte de calitate',
];

function splitSentences(text) {
  return String(text ?? '')
    .split(/(?:[.!?…]+|\n+)(?:\s+|$)/u)
    .map((s) => normalizeSpace(s))
    .filter((s) => words(s).length >= 3);
}

export function run(crawlResult) {
  const pages = htmlPages(crawlResult);
  const findings = [];
  const blockMap = new Map(); // foldedBlock -> { raw, pages: Set<string> }

  for (const page of pages) {
    const $ = load(page);
    const url = page.url;

    const mainText = extractText($, { main: true });
    const fullText = mainText || extractText($, { main: false });
    const pageWords = words(fullText);
    const wordCount = pageWords.length;

    // ---- 1. Conținut subțire (< 250 cuvinte)
    if (wordCount < MIN_WORD_COUNT) {
      findings.push(finding({
        ruleId: 'content.thin_content',
        category: C,
        severity: wordCount < 100 ? 'high' : 'medium',
        pageUrl: url,
        title: 'Conținut insuficient pe pagină (thin content)',
        evidence: {
          summary: `Pagina conține doar ${wordCount} cuvinte în zona principală`,
          snippet: truncate(fullText, 240),
          value: wordCount,
          expected: `cel puțin ${MIN_WORD_COUNT} cuvinte`,
        },
        whyItMatters: 'Paginile cu foarte puțin text oferă puține detalii utile vizitatorilor și se clasează greu în motoarele de căutare.',
        recommendation: 'Dezvoltă pagina cu detalii concrete: ce problemă rezolvi, cum funcționează serviciul/produsul, răspunsuri la întrebări frecvente și exemple reale.',
        effort: 'medium',
      }));
    }

    // ---- 2. Lizibilitate: fraze prea lungi (> 25 cuvinte în medie)
    const sentences = splitSentences(fullText);
    if (sentences.length >= 2) {
      const sentenceWordCounts = sentences.map((s) => words(s).length);
      const totalSentenceWords = sentenceWordCounts.reduce((a, b) => a + b, 0);
      const avgWords = Math.round((totalSentenceWords / sentences.length) * 10) / 10;

      if (avgWords > MAX_AVG_SENTENCE_WORDS) {
        let longestIdx = 0;
        for (let i = 1; i < sentenceWordCounts.length; i++) {
          if (sentenceWordCounts[i] > sentenceWordCounts[longestIdx]) longestIdx = i;
        }
        findings.push(finding({
          ruleId: 'content.readability.long_sentences',
          category: C,
          severity: avgWords > 35 ? 'medium' : 'low',
          pageUrl: url,
          title: 'Fraze foarte lungi, greu de urmărit',
          evidence: {
            summary: `Lungimea medie a frazelor este de ${avgWords} cuvinte (cea mai lungă frază are ${sentenceWordCounts[longestIdx]} cuvinte)`,
            snippet: truncate(sentences[longestIdx], 280),
            value: avgWords,
            expected: `medie sub ${MAX_AVG_SENTENCE_WORDS} cuvinte pe frază`,
          },
          whyItMatters: 'Frazele lungi, cu multe subordonate, obosesc cititorul (mai ales pe ecranul telefonului) și reduc șansa ca mesajul să fie reținut.',
          recommendation: 'Împarte frazele lungi în 2–3 propoziții scurte (15–20 de cuvinte) și exprimă o singură idee pe propoziție.',
          effort: 'low',
        }));
      }
    }

    // ---- 3. Paragrafe foarte lungi (> 120 cuvinte)
    const longParagraphs = [];
    $('p').each((_, el) => {
      const text = normalizeSpace($(el).text());
      const wc = words(text).length;
      if (wc > MAX_PARAGRAPH_WORDS) {
        longParagraphs.push({ text, wc });
      }
    });
    if (longParagraphs.length > 0) {
      longParagraphs.sort((a, b) => b.wc - a.wc);
      const worst = longParagraphs[0];
      findings.push(finding({
        ruleId: 'content.paragraphs.too_long',
        category: C,
        severity: 'low',
        pageUrl: url,
        title: 'Paragrafe prea lungi („ziduri de text”)',
        evidence: {
          summary: `${longParagraphs.length} paragraf(e) depășesc ${MAX_PARAGRAPH_WORDS} de cuvinte (cel mai lung are ${worst.wc} cuvinte)`,
          snippet: truncate(worst.text, 280),
          value: worst.wc,
          expected: `maximum ${MAX_PARAGRAPH_WORDS} cuvinte per paragraf`,
        },
        whyItMatters: 'Blocurile compacte de text descurajează lectura pe web, unde utilizatorii scanează vizual pagina.',
        recommendation: 'Sparge paragrafele lungi în paragrafe de 3–5 rânduri, adaugă subtitluri (<h2>/<h3>) și liste cu puncte (<ul>).',
        effort: 'low',
      }));
    }

    // ---- 4. Colectare blocuri de text pentru detecția repetițiilor între pagini
    $('main p, article p, section p, body p').each((_, el) => {
      if ($(el).closest('nav, header, footer, [role="navigation"], [role="contentinfo"]').length) return;
      const raw = normalizeSpace($(el).text());
      const wc = words(raw).length;
      if (wc < MIN_DUPLICATE_BLOCK_WORDS) return;
      const key = fold(raw);
      if (!blockMap.has(key)) {
        blockMap.set(key, { raw, pages: new Set() });
      }
      blockMap.get(key).pages.add(url);
    });

    // ---- 5. Expresii generice / clișee
    const foldedPage = fold(fullText);
    const matchedPhrases = GENERIC_PHRASES.filter((phrase) => foldedPage.includes(phrase));
    if (matchedPhrases.length > 0) {
      const list = matchedPhrases.slice(0, 5).map((p) => `„${p}”`).join(', ');
      findings.push(finding({
        ruleId: 'content.generic_phrases',
        category: C,
        severity: matchedPhrases.length >= 3 ? 'medium' : 'low',
        pageUrl: url,
        title: 'Expresii generice și clișee fără dovezi concrete',
        evidence: {
          summary: `Am găsit ${matchedPhrases.length} formulări generice pe pagină: ${list}`,
          snippet: list,
          value: matchedPhrases.length,
          expected: 'afirmații concrete susținute de cifre, exemple sau certificări',
        },
        whyItMatters: 'Expresiile precum „calitate superioară” sau „echipă tânără și dinamică” apar pe mii de site-uri și nu diferențiază oferta ta în ochii clientului.',
        recommendation: 'Înlocuiește clișeele cu fapte verificabile: număr de proiecte livrate, timp de răspuns garantat, ani de experiență, garanție oferită sau studii de caz.',
        effort: 'low',
      }));
    }
  }

  // ---- Raportare blocuri de text repetate între pagini
  for (const [key, { raw, pages: pageSet }] of blockMap.entries()) {
    const affected = [...pageSet];
    if (affected.length < 2) continue;
    findings.push(finding({
      ruleId: 'content.duplicate_blocks',
      category: C,
      severity: affected.length >= 3 ? 'medium' : 'low',
      pageUrl: null,
      detail: key.slice(0, 80),
      affectedPages: affected,
      title: 'Bloc de text repetat identic pe mai multe pagini',
      evidence: {
        summary: `Același paragraf apare identic pe ${affected.length} pagini`,
        snippet: truncate(raw, 280),
        value: affected.length,
        expected: 'conținut original adaptat fiecărei pagini',
      },
      whyItMatters: 'Repetarea acelorași paragrafe pe mai multe pagini reduce valoarea percepută a conținutului și diluează relevanța SEO a fiecărei pagini.',
      recommendation: 'Păstrează paragraful doar pe pagina unde este cel mai relevant și rescrie sau elimină copia de pe celelalte pagini.',
      effort: 'low',
    }));
  }

  return findings;
}
