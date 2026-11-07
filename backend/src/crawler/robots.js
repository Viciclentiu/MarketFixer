// Parser simplu robots.txt (grupuri User-agent, Allow/Disallow cu * și $, Sitemap).

export function parseRobots(text) {
  const groups = [];
  const sitemaps = [];
  let current = null;
  let lastWasAgent = false;
  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (key === 'allow' || key === 'disallow') {
      lastWasAgent = false;
      if (!current) continue;
      if (key === 'disallow' && value === '') continue; // "Disallow:" gol = permite tot
      if (key === 'allow' && value === '') continue;
      current.rules.push({ allow: key === 'allow', path: value });
    } else if (key === 'sitemap') {
      if (value) sitemaps.push(value);
    } else {
      lastWasAgent = false;
    }
  }
  return { groups, sitemaps };
}

function ruleToRegex(path) {
  let p = path;
  const anchored = p.endsWith('$');
  if (anchored) p = p.slice(0, -1);
  const body = p
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

/**
 * @param {string|null} text conținutul robots.txt
 * @param {string} userAgent token-ul botului (ex: "MarketFixerBot")
 */
export function createRobotsMatcher(text, userAgent = 'MarketFixerBot') {
  if (!text) return { isAllowed: () => true, sitemaps: [] };
  const { groups, sitemaps } = parseRobots(text);
  const ua = userAgent.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((a) => a.split('/')[0].trim() === ua));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes('*'));
  const rules = chosen.flatMap((g) => g.rules).map((r) => ({ ...r, re: ruleToRegex(r.path) }));

  function isAllowed(url) {
    let path;
    try {
      const u = new URL(url);
      path = u.pathname + u.search;
    } catch {
      return false;
    }
    if (path === '/robots.txt') return true;
    let best = null;
    for (const rule of rules) {
      if (!rule.re.test(path)) continue;
      if (
        !best ||
        rule.path.length > best.path.length ||
        (rule.path.length === best.path.length && rule.allow)
      ) {
        best = rule;
      }
    }
    return !best || best.allow;
  }

  return { isAllowed, sitemaps };
}
