import * as cheerio from 'cheerio';

const text = (value) => String(value ?? '').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}★☆✦✧✓✔✕✖]/gu, '').trim();
const escape = (value) => text(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const list = (value) => Array.isArray(value) ? value : [];
const hex = (value) => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
const length = (value, fallback) => /^(?:0|\d+(?:\.\d+)?(?:px|rem|em|%|vw|ch))$/.test(String(value)) ? String(value) : fallback;
const font = (value, fallback) => /^[\w -]{1,80}$/.test(value || '') ? value : fallback;

export function buildEvidenceBasedSpec(input) {
  const content = input.extractedContent;
  const evidence = [];
  const sections = [{
    id: 'introduction', type: 'introduction', heading: content.headings[0]?.text || content.title || content.siteName,
    body: content.metaDescription || '', layout: { variant: 'stack' },
    assets: [], actions: [], items: [], evidenceRefs: ['source-title'],
  }];
  evidence.push({ id: 'source-title', sourceField: 'extractedContent.title', sourceExcerpt: content.title || content.siteName });
  content.textBlocks.forEach((body, index) => {
    const id = `source-text-${index}`;
    evidence.push({ id, sourceField: `extractedContent.textBlocks[${index}]`, sourceExcerpt: body });
    sections.push({ id: `content-${index + 1}`, type: 'content', body, items: [], actions: [], assets: [], layout: { variant: 'stack' }, evidenceRefs: [id] });
  });
  return {
    provider: 'rules', skillsApplied: [],
    limitations: ['Structură de bază generată din conținutul sursă, fără proiectare AI.'],
    pageUnderstanding: { siteType: 'unknown', confidence: 'low', uncertainties: ['Tipul paginii nu a fost evaluat de AI.'] },
    designPlan: { layoutConcept: 'Conținutul sursă în ordinea disponibilă.', signatureElement: null },
    seo: { title: content.title || content.siteName, metaDescription: content.metaDescription || content.textBlocks[0] || '' },
    design: {
      direction: 'Prezentare neutră a conținutului existent.',
      colors: { background: '#ffffff', surface: '#f5f5f5', text: '#202020', mutedText: '#595959', primary: '#234b70', onPrimary: '#ffffff', border: '#dddddd', focus: '#234b70' },
      typography: { displayFont: 'Georgia', bodyFont: 'Arial', utilityFont: 'Arial', bodySize: '16px', bodyLineHeight: '1.6', headingScale: ['2.5rem', '1.75rem', '1.25rem'] },
      layout: { maxContentWidth: '72rem', borderRadius: '0', spacingScale: ['8px', '16px', '24px', '48px'] }, customCss: '',
    },
    navigation: { preserveExistingDestinations: true, items: input.navigation },
    sections, evidence, preservedInteractions: input.existingInteractions,
    auditResolutionPlan: [], validationChecklist: [],
  };
}

// Keep model choices while restricting destinations and images to the source page.
export function normalizeDesignSpec(data, input, fallback) {
  if (!data || !Array.isArray(data.sections) || !data.sections.length ||
      data.sections.some((section) => !section || typeof section !== 'object' || Array.isArray(section))) {
    throw new Error('Răspunsul AI nu conține o structură validă de secțiuni. Generează din nou designul.');
  }
  const absolute = (value) => {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
      const url = new URL(String(value), input.pageUrl);
      return /^(https?:|tel:|mailto:)$/.test(url.protocol) ? url.href : null;
    } catch { return null; }
  };
  const sourceLinks = [
    ...input.navigation, ...input.existingInteractions,
    ...list(input.sourceLinks).map((href) => ({ href })),
    ...input.extractedContent.contacts.emails.map((email) => ({ href: `mailto:${email}` })),
    { href: input.pageUrl },
  ];
  const knownLinks = new Set(sourceLinks.map((link) => absolute(link.href)).filter(Boolean));
  const ids = new Set();
  const sections = data.sections.map((section, index) => {
    let id = text(section.id).replace(/[^a-zA-Z0-9_-]/g, '-') || `section-${index + 1}`;
    if (ids.has(id)) id = `${id}-${index + 1}`;
    while (ids.has(id)) id += '-section';
    ids.add(id);
    return { ...section, id };
  });
  const href = (value) => {
    if (typeof value !== 'string' || !value) return null;
    if (value.startsWith('#') && ids.has(value.slice(1))) return value;
    const resolved = absolute(value);
    return knownLinks.has(resolved) ? resolved : null;
  };
  const action = (value) => {
    const destination = href(value?.href);
    return destination && value?.label ? { ...value, label: text(value.label), href: destination } : null;
  };
  const asset = (value) => {
    const url = absolute(typeof value === 'string' ? value : value?.url);
    const original = input.assets.find((item) => item.url === url);
    return original ? { ...original } : null;
  };
  const variants = new Set(['stack', 'split', 'grid', 'editorial']);
  const normalizedSections = sections.map((section) => ({
    ...section, type: text(section.type || 'content'), heading: text(section.heading), body: text(section.body),
    actions: list(section.actions).map(action).filter(Boolean),
    assets: list(section.assets).map(asset).filter(Boolean),
    items: list(section.items).map((item) => {
      if (typeof item === 'string') return { body: text(item), actions: [], assets: [] };
      if (!item || typeof item !== 'object') return null;
      return {
        title: text(item.title),
        heading: text(item.heading || item.title || item.label), body: text(item.body || item.description || item.text),
        // Monetary values are copied only when actually found on the source page.
        price: input.extractedContent.prices.includes(item.price) ? item.price : '',
        actions: [...list(item.actions), ...(item.action ? [item.action] : []), ...(item.href ? [{ href: item.href, label: item.label || item.title || item.heading }] : [])].map(action).filter(Boolean),
        assets: [...list(item.assets), ...(item.asset ? [item.asset] : []), ...(item.image ? [item.image] : [])].map(asset).filter(Boolean),
      };
    }).filter(Boolean),
    layout: {
      ...section.layout,
      variant: variants.has(section.layout?.variant) ? section.layout.variant : 'stack',
      columns: Math.min(4, Math.max(1, Number.parseInt(section.layout?.columns, 10) || 3)),
    },
  }));
  const navigation = list(data.navigation?.items).map(action).filter(Boolean);
  for (const source of input.navigation) {
    if (!navigation.some((item) => item.href === source.href)) {
      const validated = action(source);
      if (validated) navigation.push(validated);
    }
  }
  const signature = data.designPlan?.signatureElement;
  const colors = Object.fromEntries(Object.entries(fallback.design.colors).map(([key, value]) => [key, hex(data.design?.colors?.[key]) ? data.design.colors[key] : value]));
  return {
    ...fallback, ...data,
    seo: { title: text(data.seo?.title || fallback.seo.title), metaDescription: text(data.seo?.metaDescription || fallback.seo.metaDescription) },
    designPlan: { ...data.designPlan, signatureElement: signature?.title ? {
      label: text(signature.label), title: text(signature.title), description: text(signature.description),
      highlightValue: text(signature.highlightValue), actionLabel: text(signature.actionLabel), actionHref: href(signature.actionHref),
    } : null },
    design: {
      ...fallback.design, ...data.design, colors,
      typography: { ...fallback.design.typography, ...data.design?.typography },
      layout: { ...fallback.design.layout, ...data.design?.layout },
      customCss: typeof data.design?.customCss === 'string' ? data.design.customCss : '',
    },
    sections: normalizedSections, navigation: { preserveExistingDestinations: true, items: navigation },
    preservedInteractions: input.existingInteractions,
    evidence: list(data.evidence).filter((entry) => entry && typeof entry === 'object' && entry.sourceField && entry.sourceExcerpt),
    auditResolutionPlan: list(data.auditResolutionPlan),
    limitations: [...list(data.limitations), ...(input.existingInteractions.some((item) => item.type === 'form')
      ? ['Formularele existente sunt disponibile în vizualizarea Site original; integrarea lor în designul nou necesită implementare.'] : [])],
  };
}

export function generateCssFromSpec(spec) {
  const c = spec.design.colors;
  const t = spec.design.typography;
  const layout = spec.design.layout;
  const display = font(t.displayFont, 'Georgia');
  const body = font(t.bodyFont, 'Arial');
  const utility = font(t.utilityFont, body);
  const fonts = [...new Set([display, body, utility])].map((name) => `family=${encodeURIComponent(name)}:wght@400;500;600;700;800`).join('&');
  const spacing = list(layout.spacingScale).map((value) => length(value, '1rem'));
  const headings = list(t.headingScale);
  return `/* MarketFixer — design construit din specificația paginii */
@import url('https://fonts.googleapis.com/css2?${fonts}&display=swap');
:root {
  --mf-bg: ${c.background}; --mf-surface: ${c.surface}; --mf-text: ${c.text};
  --mf-muted: ${c.mutedText}; --mf-primary: ${c.primary}; --mf-on-primary: ${c.onPrimary};
  --mf-border: ${c.border}; --mf-focus: ${c.focus};
  --mf-font-display: '${display}', serif; --mf-font-body: '${body}', sans-serif; --mf-font-utility: '${utility}', monospace;
  --mf-max-width: ${length(layout.maxContentWidth, '72rem')}; --mf-radius: ${length(layout.borderRadius, '0')};
  --mf-body-size: ${length(t.bodySize, '16px')}; --mf-line-height: ${/^[1-2](?:\.\d+)?$/.test(String(t.bodyLineHeight)) ? t.bodyLineHeight : '1.6'};
  --mf-h1: ${length(headings[0], '2.5rem')}; --mf-h2: ${length(headings[1], '1.75rem')}; --mf-h3: ${length(headings[2], '1.25rem')};
  ${spacing.map((value, index) => `--mf-space-${index + 1}: ${value};`).join('\n  ')}
  --mf-gap: ${spacing[2] || '1.5rem'}; --mf-section-space: ${spacing.at(-1) || '3rem'};
}
body.mf-redesign-active { margin: 0; background: var(--mf-bg); }
body.mf-redesign-active #mf-original-site-wrapper { display: none !important; }
body:not(.mf-redesign-active) #mf-ai-showcase { display: none !important; }
.mf-FloatingBar { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 1rem; padding: .75rem 1rem; background: #ffffff; color: #202020; border-bottom: 1px solid #dddddd; font: 14px Arial, sans-serif; }
.mf-FloatingBar button { padding: .5rem 1rem; cursor: pointer; }
.mf-FloatingBar__btn--active { font-weight: bold; text-decoration: underline; }
.mf-page { background: var(--mf-bg); color: var(--mf-text); font-family: var(--mf-font-body); font-size: var(--mf-body-size); line-height: var(--mf-line-height); overflow-wrap: anywhere; }
.mf-page, .mf-page * { box-sizing: border-box; }
.mf-container { width: min(100% - 2rem, var(--mf-max-width)); margin-inline: auto; }
.mf-page h1, .mf-page h2, .mf-page h3 { font-family: var(--mf-font-display); line-height: 1.15; margin: 0 0 1rem; }
.mf-page h1 { font-size: var(--mf-h1); } .mf-page h2 { font-size: var(--mf-h2); } .mf-page h3 { font-size: var(--mf-h3); }
.mf-page p { white-space: pre-line; }
.mf-page a { color: var(--mf-primary); }
.mf-page img { display: block; max-width: 100%; height: auto; border-radius: var(--mf-radius); }
.mf-page :focus-visible, .mf-FloatingBar :focus-visible { outline: 3px solid var(--mf-focus); outline-offset: 4px; }
.mf-topbar, .mf-footer { padding-block: var(--mf-gap); border-block-end: 1px solid var(--mf-border); }
.mf-topbar__inner, .mf-nav, .mf-actions { display: flex; align-items: center; flex-wrap: wrap; gap: var(--mf-gap); }
.mf-topbar__inner { justify-content: space-between; }
.mf-brand { display: flex; align-items: center; gap: 1rem; }
.mf-brand img { max-width: 10rem; max-height: 4rem; object-fit: contain; }
.mf-section { padding-block: var(--mf-section-space); }
.mf-section__content, .mf-section__items, .mf-section__media { display: grid; gap: var(--mf-gap); min-width: 0; }
.mf-section__content > *, .mf-item { min-width: 0; }
.mf-section--split .mf-section__content { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items: center; }
.mf-section--split .mf-section__items { grid-column: 1 / -1; }
.mf-section--grid .mf-section__items { grid-template-columns: repeat(var(--mf-columns, 3), minmax(0, 1fr)); }
.mf-section--editorial .mf-section__content { grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); align-items: start; }
.mf-section--editorial .mf-section__intro { position: sticky; top: 1rem; }
.mf-section--editorial .mf-section__media { grid-column: 2; }
.mf-section--editorial .mf-section__body, .mf-section--editorial .mf-section__items { grid-column: 2; }
.mf-item { padding: var(--mf-gap); background: var(--mf-surface); border-radius: var(--mf-radius); }
.mf-price, .mf-label { font-family: var(--mf-font-utility); }
.mf-actions { margin-block-start: var(--mf-gap); }
.mf-page .mf-button { display: inline-block; padding: .75em 1.25em; border: 1px solid var(--mf-primary); border-radius: var(--mf-radius); color: var(--mf-on-primary); background: var(--mf-primary); text-decoration: none; }
.mf-signature { border-block: 1px solid var(--mf-border); }
${spec.design.customCss || ''}
@media (max-width: 700px) {
  .mf-section--split .mf-section__content, .mf-section--editorial .mf-section__content, .mf-section--grid .mf-section__items { grid-template-columns: minmax(0, 1fr); }
  .mf-section--editorial .mf-section__intro { position: static; }
  .mf-section--editorial .mf-section__media, .mf-section--editorial .mf-section__body, .mf-section--editorial .mf-section__items { grid-column: auto; }
  .mf-page h1 { font-size: min(var(--mf-h1), 12vw); }
}
@media (prefers-reduced-motion: reduce) {
  .mf-page *, .mf-page *::before, .mf-page *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }
}
`;
}

export function renderDesignHtml({ siteName, cleanPageUrl, spec, assets = [], includeSwitcher = true }) {
  const images = (items) => list(items).map((item) => `<img src="${escape(item.url)}" alt="${escape(item.alt || '')}" loading="lazy">`).join('');
  const actions = (items) => list(items).length ? `<div class="mf-actions">${items.map((item) => `<a class="mf-button" href="${escape(item.href)}">${escape(item.label)}</a>`).join('')}</div>` : '';
  let hasH1 = false;
  const sectionHtml = spec.sections.map((section) => {
    const editorial = section.layout?.variant === 'editorial';
    const tag = hasH1 ? 'h2' : 'h1';
    if (section.heading) hasH1 = true;
    return `<section id="${escape(section.id)}" class="mf-section mf-section--${escape(section.layout?.variant || 'stack')}" data-section-type="${escape(section.type)}" style="--mf-columns: ${section.layout?.columns || 3}">
      <div class="mf-container mf-section__content">
        <div class="mf-section__intro">${section.heading ? `<${tag}>${escape(section.heading)}</${tag}>` : ''}${section.body && !editorial ? `<p>${escape(section.body)}</p>` : ''}${actions(section.actions)}</div>
        ${editorial && section.body ? `<div class="mf-section__body"><p>${escape(section.body)}</p></div>` : ''}
        ${list(section.assets).length ? `<div class="mf-section__media">${images(section.assets)}</div>` : ''}
        ${list(section.items).length ? `<div class="mf-section__items">${section.items.map((item) => `<article class="mf-item">${images(item.assets)}${item.heading ? `<h3>${escape(item.heading)}</h3>` : ''}${item.body ? `<p>${escape(item.body)}</p>` : ''}${item.price ? `<p class="mf-price">${escape(item.price)}</p>` : ''}${actions(item.actions)}</article>`).join('')}</div>` : ''}
      </div>
    </section>`;
  }).join('\n');
  const logo = assets.find((asset) => asset.role === 'logo');
  const signature = spec.designPlan?.signatureElement;
  return `${includeSwitcher ? `<div class="mf-FloatingBar"><span>MarketFixer</span><div><button type="button" id="mf-btn-redesigned" class="mf-FloatingBar__btn--active" aria-pressed="true">Design actualizat</button><button type="button" id="mf-btn-original" aria-pressed="false">Site original</button></div></div>` : ''}
  <div ${includeSwitcher ? 'id="mf-ai-showcase" ' : ''}class="mf-page">
    <header class="mf-topbar"><div class="mf-container mf-topbar__inner"><a class="mf-brand" href="${escape(cleanPageUrl)}">${logo ? images([logo]) : ''}<span>${escape(siteName)}</span></a>
    <nav class="mf-nav" aria-label="Navigație principală">${list(spec.navigation?.items).map((item) => `<a href="${escape(item.href)}">${escape(item.label)}</a>`).join('')}</nav></div></header>
    <main>${!hasH1 ? `<h1 class="mf-container">${escape(siteName)}</h1>` : ''}${sectionHtml}
    ${signature?.title ? `<aside class="mf-section mf-signature"><div class="mf-container">${signature.label ? `<p class="mf-label">${escape(signature.label)}</p>` : ''}<h2>${escape(signature.title)}</h2>${signature.description ? `<p>${escape(signature.description)}</p>` : ''}${signature.highlightValue ? `<p>${escape(signature.highlightValue)}</p>` : ''}${signature.actionHref ? actions([{ href: signature.actionHref, label: signature.actionLabel }]) : ''}</div></aside>` : ''}
    </main><footer class="mf-footer"><div class="mf-container"><a href="${escape(cleanPageUrl)}">${escape(siteName)}</a></div></footer>
  </div>`;
}

// Produce JSX from the same rendered tree so exported React and HTML stay aligned.
export function htmlToJsx(html) {
  const $ = cheerio.load(html, {}, false);
  const convert = (node) => {
    if (node.type === 'text') return `{${JSON.stringify(node.data)}}`;
    if (node.type !== 'tag') return '';
    const attrs = Object.entries(node.attribs || {}).map(([key, value]) => {
      if (key === 'style') return `style={${JSON.stringify(Object.fromEntries(value.split(';').filter((part) => part.includes(':')).map((part) => { const pos = part.indexOf(':'); return [part.slice(0, pos).trim(), part.slice(pos + 1).trim()]; })))}}`;
      return `${key === 'class' ? 'className' : key}={${JSON.stringify(value)}}`;
    }).join(' ');
    const start = `<${node.name}${attrs ? ` ${attrs}` : ''}`;
    if (['img', 'br', 'hr', 'input'].includes(node.name)) return `${start} />`;
    return `${start}>${(node.children || []).map(convert).join('')}</${node.name}>`;
  };
  return $.root().contents().toArray().map(convert).join('');
}
