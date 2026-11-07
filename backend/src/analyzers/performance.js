// Analiza CSV de performanță: detectează automat dimensiunile (coloane categoriale)
// și metricile (coloane numerice), grupează și compară mediile cu mărimea eșantionului (n).
// Respectă principiul MarketFixer: doar comparații observate în date, fără speculații despre public.
import { parse as parseCsvSync } from 'csv-parse/sync';

const DATE_OR_ID_COL_RE = /^(id|uuid|guid|date|data|created_at|updated_at|timestamp|url|link|permalink|post_id)$/i;
const DATE_VALUE_RE = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:[T\s]\d{1,2}:\d{2})?$/;

export function parseNumericValue(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || DATE_VALUE_RE.test(trimmed)) return null;

  // Eliminăm simboluri valutare, procente și spații
  const cleaned = trimmed
    .replace(/[%€$£]|(?:\b(?:ron|lei|eur|usd)\b)/gi, '')
    .replace(/\s+/g, '');
  if (!cleaned || !/\d/.test(cleaned)) return null;

  // Tratare separatori mii/zecimale: ex "1.234,56" vs "1,234.56" vs "12,5"
  let normalized = cleaned;
  if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(cleaned)) {
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (/^-?\d{1,3}(,\d{3})+\.\d+$/.test(cleaned)) {
    normalized = cleaned.replace(/,/g, '');
  } else if (/^-?\d+,\d+$/.test(cleaned)) {
    normalized = cleaned.replace(',', '.');
  } else {
    normalized = cleaned.replace(/,/g, '');
  }

  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function normalizeRowsInput(input) {
  if (Array.isArray(input)) return input.filter((r) => r && typeof r === 'object');
  if (typeof input === 'string' || Buffer.isBuffer(input)) {
    const text = Buffer.isBuffer(input) ? input.toString('utf8') : input;
    if (!text.trim()) return [];
    return parseCsvSync(text, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      bom: true,
    });
  }
  return [];
}

function detectColumns(rows, explicitColumns) {
  if (explicitColumns?.dimensions && explicitColumns?.metrics) {
    return {
      dimensions: [...explicitColumns.dimensions],
      metrics: [...explicitColumns.metrics],
    };
  }

  const allKeys = new Set();
  for (const row of rows) {
    for (const k of Object.keys(row)) {
      if (k && k.trim()) allKeys.add(k);
    }
  }

  const dimensions = [];
  const metrics = [];

  for (const col of allKeys) {
    const nonEmpty = [];
    let numericCount = 0;

    for (const row of rows) {
      const val = row[col];
      if (val === null || val === undefined || String(val).trim() === '') continue;
      nonEmpty.push(val);
      if (parseNumericValue(val) !== null) numericCount += 1;
    }

    if (nonEmpty.length === 0) continue;

    const numericRatio = numericCount / nonEmpty.length;
    if (numericRatio >= 0.8 && !DATE_OR_ID_COL_RE.test(col.trim())) {
      metrics.push(col);
    } else if (numericRatio < 0.5 && !DATE_OR_ID_COL_RE.test(col.trim())) {
      dimensions.push(col);
    }
  }

  return {
    dimensions: explicitColumns?.dimensions ? [...explicitColumns.dimensions] : dimensions,
    metrics: explicitColumns?.metrics ? [...explicitColumns.metrics] : metrics,
  };
}

export function analyzePerformance(rowsInput, { columns } = {}) {
  const warnings = [];
  const rows = normalizeRowsInput(rowsInput);
  const rowCount = rows.length;

  if (rowCount === 0) {
    warnings.push('Setul de date este gol (0 rânduri).');
    return {
      rowCount: 0,
      columnsDetected: { dimensions: [], metrics: [] },
      insights: [],
      warnings,
    };
  }

  if (rowCount < 5) {
    warnings.push(`Setul de date conține doar ${rowCount} rânduri; rezultatele au relevanță statistică redusă.`);
  }

  const columnsDetected = detectColumns(rows, columns);

  if (columnsDetected.dimensions.length === 0) {
    warnings.push('Nu a fost detectată nicio coloană categorială (dimensiune) pentru grupare.');
  }
  if (columnsDetected.metrics.length === 0) {
    warnings.push('Nu a fost detectată nicio coloană numerică (metrică) pentru calculul mediilor.');
  }

  const insights = [];

  for (const dim of columnsDetected.dimensions) {
    // Verificăm cardinalitatea dimensiunii
    const distinctValues = new Set(
      rows
        .map((r) => String(r[dim] ?? '').trim())
        .filter(Boolean),
    );
    if (distinctValues.size < 2) continue;
    if (distinctValues.size > 25 && distinctValues.size > rowCount * 0.7) {
      warnings.push(`Coloana „${dim}” are aproape doar valori unice (${distinctValues.size} din ${rowCount} rânduri) și a fost omisă din grupări.`);
      continue;
    }

    for (const metric of columnsDetected.metrics) {
      const groupBuckets = new Map(); // groupName -> number[]

      for (const row of rows) {
        const rawGroup = String(row[dim] ?? '').trim();
        if (!rawGroup) continue;
        const num = parseNumericValue(row[metric]);
        if (num === null) continue;
        if (!groupBuckets.has(rawGroup)) groupBuckets.set(rawGroup, []);
        groupBuckets.get(rawGroup).push(num);
      }

      const groups = [];
      for (const [name, vals] of groupBuckets.entries()) {
        if (!vals.length) continue;
        const total = vals.reduce((a, b) => a + b, 0);
        const mean = total / vals.length;
        groups.push({
          name,
          n: vals.length,
          mean: round2(mean),
          total: round2(total),
        });
      }

      if (groups.length < 2) continue;

      // Sortăm grupurile descrescător după medie
      groups.sort((a, b) => b.mean - a.mean || b.n - a.n);

      const top = groups[0];
      const bottom = groups[groups.length - 1];
      if (top.mean === bottom.mean) continue;

      const minN = Math.min(...groups.map((g) => g.n));
      const comparedMinN = Math.min(top.n, bottom.n);
      let confidence = 'high';
      let caveat;

      if (minN < 5 || comparedMinN < 5) {
        confidence = 'low';
        caveat = `Eșantion mic (n=${minN} în cel mai mic grup), nu generaliza fără date suplimentare.`;
      } else if (minN < 15) {
        confidence = 'medium';
        caveat = `Eșantion moderat (n minim = ${minN}); urmărește evoluția pe un volum mai mare.`;
      }

      const ratio = bottom.mean > 0 ? round2(top.mean / bottom.mean) : null;
      const diffText = ratio && ratio >= 1.2
        ? `de ${ratio}× mai mare decât`
        : `peste`;

      const statement = `Pentru dimensiunea „${dim}”, grupul „${top.name}” (n=${top.n}) are o medie observată a metricii „${metric}” de ${top.mean} (total ${top.total}), ${diffText} grupul „${bottom.name}” (n=${bottom.n}, medie ${bottom.mean}, total ${bottom.total}).`;

      const insight = {
        statement,
        evidence: {
          metric,
          groups,
        },
        confidence,
      };
      if (caveat) insight.caveat = caveat;
      insights.push(insight);
    }
  }

  return {
    rowCount,
    columnsDetected,
    insights,
    warnings,
  };
}
