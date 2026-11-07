// Comparare între două rapoarte după fingerprint-ul constatărilor (Finding.fingerprint).

const SCORE_KEYS = ['overall', 'seo', 'accessibility', 'ux', 'content'];

/**
 * Compară raportul curent cu un raport anterior.
 * @param {object} currentReport Raportul mai nou (:id)
 * @param {object} prevReport Raportul anterior (:prevId)
 * @returns {{ resolved: object[], new: object[], remaining: object[], scoreDelta: Record<string, number> }}
 */
export function compareReports(currentReport, prevReport) {
  const currentFindings = Array.isArray(currentReport?.findings) ? currentReport.findings : [];
  const prevFindings = Array.isArray(prevReport?.findings) ? prevReport.findings : [];

  const currentByFp = new Map();
  for (const f of currentFindings) {
    if (f?.fingerprint && !currentByFp.has(f.fingerprint)) {
      currentByFp.set(f.fingerprint, f);
    }
  }

  const prevByFp = new Map();
  for (const f of prevFindings) {
    if (f?.fingerprint && !prevByFp.has(f.fingerprint)) {
      prevByFp.set(f.fingerprint, f);
    }
  }

  const resolved = [];
  for (const [fp, finding] of prevByFp.entries()) {
    if (!currentByFp.has(fp)) {
      resolved.push(finding);
    }
  }

  const added = [];
  const remaining = [];
  for (const [fp, finding] of currentByFp.entries()) {
    if (prevByFp.has(fp)) {
      remaining.push(finding);
    } else {
      added.push(finding);
    }
  }

  const curScores = currentReport?.scores ?? {};
  const prevScores = prevReport?.scores ?? {};
  const allScoreKeys = new Set([...SCORE_KEYS, ...Object.keys(curScores), ...Object.keys(prevScores)]);
  const scoreDelta = {};
  for (const key of allScoreKeys) {
    const c = Number(curScores[key]);
    const p = Number(prevScores[key]);
    if (Number.isFinite(c) && Number.isFinite(p)) {
      scoreDelta[key] = Math.round((c - p) * 100) / 100;
    } else {
      scoreDelta[key] = 0;
    }
  }

  return {
    resolved,
    new: added,
    remaining,
    scoreDelta,
  };
}
