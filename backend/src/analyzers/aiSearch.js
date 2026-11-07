// Reguli pentru vizibilitate în motoarele AI / GEO (Generative Engine Optimization):
// date structurate JSON-LD (Schema.org), structură FAQ (întrebări și răspunsuri)
// și date de contact verificabile (telefon, email, adresă).
import { extractText, finding, htmlPages, load, normalizeSpace, snippetOf, truncate } from './utils.js';

const C = 'ai_search';

const ENTITY_SCHEMA_RE = /^(Organization|Corporation|LocalBusiness|Store|Restaurant|MedicalBusiness|LegalService|ProfessionalService|EducationalOrganization|NGO)$/i;
const OFFER_SCHEMA_RE = /^(Product|Service|SoftwareApplication|Course|Offer)$/i;

function collectSchemaTypes(node, out = new Set()) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const item of node) collectSchemaTypes(item, out);
    return out;
  }
  const t = node['@type'];
  if (typeof t === 'string') out.add(t);
  else if (Array.isArray(t)) {
    for (const item of t) if (typeof item === 'string') out.add(item);
  }
  for (const val of Object.values(node)) {
    if (val && typeof val === 'object') collectSchemaTypes(val, out);
  }
  return out;
}

export function run(crawlResult) {
  const pages = htmlPages(crawlResult);
  const findings = [];
  if (!pages.length) return findings;

  const siteSchemaTypes = new Set();
  let totalJsonLdScripts = 0;
  let hasFaqStructure = false;
  let hasTelLink = false;
  let hasMailtoLink = false;
  let hasAddressInfo = false;

  const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
  const RO_PHONE_RE = /(?:\+?40|0)\s*(?:7\d{2}|2\d{2}|3\d{2})[\s.-]?\d{3}[\s.-]?\d{3}\b/;
  const ADDRESS_RE = /\b(?:str(?:ada|\.)?|bd(?:ul|\.)?|bulevardul|calea|sos(?:eaua|\.)?|piata|nr\.?\s*\d+|jud(?:etul|\.)?|sector\s*[1-6])\b/i;

  for (const page of pages) {
    const $ = load(page);
    const url = page.url;

    // ---- 1. JSON-LD pe pagină
    $('script[type="application/ld+json" i]').each((_, el) => {
      totalJsonLdScripts += 1;
      const raw = ($(el).html() || $(el).text() || '').trim();
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw);
        collectSchemaTypes(parsed, siteSchemaTypes);
      } catch (err) {
        findings.push(finding({
          ruleId: 'ai_search.jsonld.invalid',
          category: C,
          severity: 'medium',
          pageUrl: url,
          title: 'Bloc JSON-LD (Schema.org) cu eroare de sintaxă JSON',
          evidence: {
            summary: `Scriptul application/ld+json nu a putut fi parsat: ${truncate(err?.message || 'JSON invalid', 100)}`,
            snippet: truncate(raw, 260),
            expected: 'JSON valid conform specificației Schema.org',
          },
          whyItMatters: 'Motoarele de căutare și asistenții AI ignoră complet blocurile JSON-LD care conțin erori de sintaxă.',
          recommendation: 'Validează blocul JSON-LD cu Rich Results Test și corectează virgulele lipsă sau ghilimelele neînchise.',
          effort: 'low',
        }));
      }
    });

    // ---- 2. Structură FAQ / Întrebări și răspunsuri
    const questionHeadings = $('h2, h3, h4, dt, summary').toArray().filter((el) => {
      const txt = normalizeSpace($(el).text());
      return txt.endsWith('?') && txt.length >= 10 && txt.length <= 180;
    });
    if (questionHeadings.length >= 2 || $('details summary').length >= 2) {
      hasFaqStructure = true;
    }

    // ---- 3. Date de contact
    if ($('a[href^="tel:" i]').length > 0) hasTelLink = true;
    if ($('a[href^="mailto:" i]').length > 0) hasMailtoLink = true;

    const fullText = extractText($);
    if (RO_PHONE_RE.test(fullText)) hasTelLink = true;
    if (EMAIL_RE.test(fullText)) hasMailtoLink = true;
    if ($('address').length > 0 || ADDRESS_RE.test(fullText)) hasAddressInfo = true;
  }

  const allTypes = [...siteSchemaTypes];
  if (allTypes.some((t) => /^FAQPage$/i.test(t))) {
    hasFaqStructure = true;
  }

  // ---- Raportare JSON-LD lipsă sau incomplet
  if (totalJsonLdScripts === 0 || allTypes.length === 0) {
    findings.push(finding({
      ruleId: 'ai_search.jsonld.missing',
      category: C,
      severity: 'medium',
      pageUrl: null,
      title: 'Lipsesc datele structurate JSON-LD (Schema.org)',
      evidence: {
        summary: `Nu am găsit niciun bloc <script type="application/ld+json"> valid pe cele ${pages.length} pagini analizate`,
        value: 0,
        expected: 'JSON-LD cu Organization / LocalBusiness, Product / Service sau FAQPage',
      },
      whyItMatters: 'Motoarele AI (ChatGPT Search, Perplexity, Google AI Overviews) se bazează pe Schema.org pentru a extrage fără ambiguitate datele despre firmă, servicii, prețuri și întrebări frecvente.',
      recommendation: 'Adaugă în paginile principale blocuri <script type="application/ld+json"> pentru Organization sau LocalBusiness, respectiv Service/Product și FAQPage.',
      effort: 'medium',
    }));
  } else {
    const hasEntity = allTypes.some((t) => ENTITY_SCHEMA_RE.test(t));
    const hasOffer = allTypes.some((t) => OFFER_SCHEMA_RE.test(t));
    if (!hasEntity) {
      findings.push(finding({
        ruleId: 'ai_search.jsonld.organization_missing',
        category: C,
        severity: 'low',
        pageUrl: null,
        title: 'Lipsește schema Organization / LocalBusiness din JSON-LD',
        evidence: {
          summary: `Tipuri Schema.org găsite: ${allTypes.join(', ')}; lipsește Organization sau LocalBusiness`,
          value: allTypes.join(', '),
          expected: 'Organization sau LocalBusiness cu name, url, logo, telephone, address',
        },
        whyItMatters: 'Fără schema Organization/LocalBusiness, motoarele de căutare și asistenții AI nu pot lega sigur site-ul de entitatea juridică, adresă și datele de contact.',
        recommendation: 'Adaugă pe pagina principală o schemă JSON-LD de tip Organization sau LocalBusiness cu denumirea firmei, telefon, adresă și linkurile de social media (sameAs).',
        effort: 'low',
      }));
    }
    if (!hasOffer && pages.length >= 2) {
      findings.push(finding({
        ruleId: 'ai_search.jsonld.offer_missing',
        category: C,
        severity: 'low',
        pageUrl: null,
        title: 'Lipsesc schemele Product / Service pentru ofertă',
        evidence: {
          summary: `Tipuri Schema.org găsite (${allTypes.join(', ')}), fără Product sau Service`,
          value: allTypes.join(', '),
          expected: 'Service sau Product pe paginile de ofertă',
        },
        whyItMatters: 'Marcarea structurată a serviciilor sau produselor ajută motoarele AI să recomande oferta ta când utilizatorii caută soluții specifice.',
        recommendation: 'Adaugă schema Service sau Product pe paginile de servicii/produse, incluzând descrierea, zona deservită și, dacă e posibil, intervalul de preț.',
        effort: 'medium',
      }));
    }
  }

  // ---- Raportare structură FAQ lipsă
  if (!hasFaqStructure) {
    findings.push(finding({
      ruleId: 'ai_search.faq.missing',
      category: C,
      severity: 'low',
      pageUrl: null,
      title: 'Lipsesc secțiunile de Întrebări Frecvente (FAQ)',
      evidence: {
        summary: 'Nu am găsit nicio secțiune FAQ (subtitluri interogative cu „?”, elemente <details>/<summary> sau schema FAQPage)',
        expected: 'secțiune cu întrebări frecvente și răspunsuri directe pe paginile cheie',
      },
      whyItMatters: 'Oamenii pun întrebări complete în motoarele AI și în Google. Paginile care conțin perechi clare Întrebare–Răspuns sunt citate mult mai des în răspunsurile generate de AI.',
      recommendation: 'Adaugă pe pagina principală și pe paginile de servicii o secțiune cu 4–6 întrebări frecvente reale ale clienților (formulate cu „?” în <h3> sau <summary>) și marcheaz-o cu schema FAQPage.',
      effort: 'low',
    }));
  }

  // ---- Raportare date de contact
  const missingContact = [];
  if (!hasTelLink) missingContact.push('telefon');
  if (!hasMailtoLink) missingContact.push('email');
  if (!hasAddressInfo) missingContact.push('adresă fizică');

  if (missingContact.length >= 2) {
    findings.push(finding({
      ruleId: 'ai_search.contact.incomplete',
      category: C,
      severity: missingContact.length === 3 ? 'high' : 'medium',
      pageUrl: null,
      title: 'Date de contact incomplete sau greu de extras automat',
      evidence: {
        summary: `Nu am putut detecta în paginile analizate: ${missingContact.join(', ')}`,
        value: missingContact.join(', '),
        expected: 'telefon (link tel:), email (link mailto:) și adresă în subsol sau pe pagina de contact',
      },
      whyItMatters: 'Prezența datelor de contact complete (NAP: Nume, Adresă, Telefon) este un semnal major de încredere (E-E-A-T) pentru Google, asistenții AI și clienții reali.',
      recommendation: 'Afișează în subsolul site-ului și pe pagina de Contact numărul de telefon (cu <a href="tel:...">), adresa de email (cu <a href="mailto:...">) și adresa fizică într-un element <address>.',
      effort: 'low',
    }));
  }

  return findings;
}
