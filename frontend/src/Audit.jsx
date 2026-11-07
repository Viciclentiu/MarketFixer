import React, { useEffect, useState } from "react";
import { request, scanPath } from "./api";
import wrench from "./assets/wrench.svg";

const categories = {
  seo: "SEO",
  technical: "Tehnic",
  accessibility: "Accesibilitate",
  ux: "Experiență",
  content: "Conținut",
  ai_search: "Căutare AI",
};
const severity = {
  critical: "Critică",
  high: "Ridicată",
  medium: "Medie",
  low: "Scăzută",
};
const statusLabels = {
  queued: "În așteptare",
  crawling: "Explorăm paginile",
  analyzing: "Analizăm site-ul",
  done: "Finalizată",
  failed: "Eșuată",
};
const scoreLabels = {
  overall: "Scor general",
  seo: "SEO",
  accessibility: "Accesibilitate",
  ux: "Experiență",
  content: "Conținut",
};
const date = (value) => (value ? new Date(value).toLocaleString("ro-RO") : "—");

function Finding({ finding }) {
  return (
    <details className="audit-finding">
      <summary>
        <span className={`audit-badge audit-badge--${finding.severity}`}>
          {severity[finding.severity]}
        </span>
        <strong>{finding.title}</strong>
        <span>{categories[finding.category]}</span>
      </summary>
      <div className="audit-finding__body">
        {finding.pageUrl && (
          <a href={finding.pageUrl} target="_blank" rel="noreferrer">
            {finding.pageUrl} ↗
          </a>
        )}
        <h4>Dovada</h4>
        <p>{finding.evidence.summary}</p>
        {finding.evidence.value != null && (
          <p>Valoare: {String(finding.evidence.value)}</p>
        )}
        {finding.evidence.expected && (
          <p>Așteptat: {finding.evidence.expected}</p>
        )}
        {finding.evidence.snippet && <pre>{finding.evidence.snippet}</pre>}
        <h4>De ce contează</h4>
        <p>{finding.whyItMatters}</p>
        <h4>Ce poți schimba</h4>
        <p>{finding.recommendation}</p>
        <small>
          Efort: {severity[finding.effort]} · Sursă: {finding.source}
        </small>
        {finding.affectedPages?.length > 0 && (
          <details>
            <summary>Pagini afectate ({finding.affectedPages.length})</summary>
            <ul>
              {finding.affectedPages.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </details>
  );
}

export default function Audit() {
  const params = new URLSearchParams(window.location.search);
  const [id, setId] = useState(params.get("scan") || "");
  const [url, setUrl] = useState(params.get("url") || "");
  const [maxPages, setMaxPages] = useState(20);
  const [scan, setScan] = useState(null);
  const [report, setReport] = useState(null);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [category, setCategory] = useState("all");
  const [level, setLevel] = useState("all");
  const [comparison, setComparison] = useState(null);
  const [previous, setPrevious] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [fixes, setFixes] = useState(null);
  const [fixing, setFixing] = useState(false);
  const [fixError, setFixError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    request("/scans", { signal: controller.signal })
      .then(setHistory)
      .catch((e) => {
        if (e.name !== "AbortError") setHistoryError(e.message);
      });
    return () => controller.abort();
  }, [id, report, retry]);

  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    let timer;
    setScan(null);
    setReport(null);
    setError("");
    setComparison(null);
    setPrevious("");
    setUploadError("");
    setFixes(null);
    setFixError("");
    async function poll() {
      try {
        const state = await request(scanPath(id), {
          signal: controller.signal,
        });
        setScan(state);
        if (state.status === "done") {
          setReport(
            await request(`${scanPath(id)}/report`, {
              signal: controller.signal,
            }),
          );
          request(`${scanPath(id)}/fixes`, { signal: controller.signal })
            .then(setFixes)
            .catch(() => {});
        } else if (state.status === "failed") {
          setError(state.error || "Analiza nu a putut fi finalizată.");
        } else timer = setTimeout(poll, 1800);
      } catch (e) {
        if (e.name !== "AbortError") setError(e.message);
      }
    }
    poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [id, retry]);

  useEffect(() => {
    setComparison(null);
    if (!previous || !id) return;
    const controller = new AbortController();
    request(`${scanPath(id)}/compare/${encodeURIComponent(previous)}`, {
      signal: controller.signal,
    })
      .then(setComparison)
      .catch((e) => {
        if (e.name !== "AbortError") setComparison({ error: e.message });
      });
    return () => controller.abort();
  }, [id, previous]);

  function selectScan(nextId) {
    window.history.replaceState(
      null,
      "",
      `?view=audit&scan=${encodeURIComponent(nextId)}`,
    );
    setId(nextId);
    if (id === nextId) setRetry((n) => n + 1);
  }
  async function start(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await request("/scans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), maxPages: Number(maxPages) }),
      });
      selectScan(result.scanId);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function generateFixes() {
    setFixing(true);
    setFixError("");
    try {
      const result = await request(`${scanPath(id)}/remediate`, {
        method: "POST",
      });
      setFixes(result);
    } catch (e) {
      setFixError(e.message || "Eroare la generarea fișierelor reparate.");
    } finally {
      setFixing(false);
    }
  }

  async function upload(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = new FormData(form).get("file");
    if (!file?.size || file.size > 5 * 1024 * 1024) {
      setUploadError("Alege un fișier CSV nevid, de maximum 5 MB.");
      return;
    }
    setUploading(true);
    setUploadError("");
    const targetId = id;
    try {
      const performance = await request(`${scanPath(targetId)}/performance`, {
        method: "POST",
        body: new FormData(form),
      });
      setReport((current) =>
        current?.scanId === targetId ? { ...current, performance } : current,
      );
      form.reset();
    } catch (e) {
      setUploadError(e.message);
    } finally {
      setUploading(false);
    }
  }
  const active =
    id && (!scan || !["done", "failed"].includes(scan.status)) && !error;
  const findings = (report?.findings || []).filter(
    (f) =>
      (category === "all" || f.category === category) &&
      (level === "all" || f.severity === level),
  );
  const comparable = history.filter(
    (s) =>
      s.status === "done" &&
      s.scanId !== id &&
      s.url === report?.url &&
      s.createdAt < scan?.createdAt,
  );
  return (
    <div className="audit">
      <header className="header">
        <div className="container navigation">
          <a className="logo" href="/">
            market <span>fixer</span>
            <img src={wrench} alt="" />
          </a>
          <a href="/">← Înapoi la prezentare</a>
        </div>
      </header>
      <main className="container audit-main">
        <div className="audit-heading">
          <span className="audit-eyebrow">DE LA ANALIZĂ LA ACȚIUNE</span>
          <h1>
            Un site mai bun.
            <br />
            <em>Un pas clar înainte.</em>
          </h1>
          <p>
            Explorează problemele, verifică dovezile și alege ce merită
            îmbunătățit.
          </p>
        </div>
        <form className="audit-panel audit-form" onSubmit={start}>
          <label>
            Adresa site-ului
            <input
              type="url"
              required
              placeholder="https://exemplu.ro"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>
          <label>
            Limită pagini
            <select
              aria-label="Limită pagini"
              value={maxPages}
              onChange={(e) => setMaxPages(e.target.value)}
            >
              {[5, 10, 20, 50].map((n) => (
                <option key={n} value={n}>
                  {n} pagini
                </option>
              ))}
            </select>
          </label>
          <button className="button button--green" disabled={busy || !!active}>
            {busy ? "Pornim analiza…" : "Analizează site-ul →"}
          </button>
        </form>
        {error && (
          <div className="audit-error" role="alert">
            {error}{" "}
            {id && (
              <button onClick={() => setRetry((n) => n + 1)}>
                Reîncearcă încărcarea
              </button>
            )}
          </div>
        )}
        {active && (
          <section className="audit-panel" role="status">
            <span className="audit-eyebrow">ANALIZĂ ÎN DESFĂȘURARE</span>
            <h2>{statusLabels[scan?.status] || "Încărcăm scanarea…"}</h2>
            <p>{scan?.url}</p>
            <progress
              aria-label="Progresul analizei"
              max={scan?.progress?.total || 1}
              value={scan?.progress?.total > 0 ? scan.progress.done : undefined}
            />
            <p>
              {scan?.progress?.done || 0}
              {scan?.progress?.total ? ` / ${scan.progress.total}` : ""} pași
              finalizați. Poți reveni folosind această adresă.
            </p>
          </section>
        )}
        {report && (
          <>
            <section className="audit-report-heading">
              <div>
                <span className="audit-eyebrow">RAPORTUL TĂU</span>
                <h2>{report.url}</h2>
                <p>
                  {report.pagesAnalyzed} pagini analizate ·{" "}
                  {date(report.generatedAt)}
                </p>
              </div>
              <a
                className="button button--dark"
                href={`/api${scanPath(id)}/report`}
                target="_blank"
                rel="noreferrer"
              >
                Deschide datele raportului ↗
              </a>
            </section>
            <section className="audit-scores" aria-label="Scoruri">
              {Object.entries(scoreLabels).map(([key, label]) => (
                <article className="audit-panel" key={key}>
                  <span>{label}</span>
                  <strong>
                    {report.scores[key]}
                    <small>/100</small>
                  </strong>
                  <meter
                    min="0"
                    max="100"
                    value={report.scores[key]}
                    aria-label={label}
                  />
                </article>
              ))}
            </section>
            <section className="audit-panel audit-fixes-panel">
              <div className="audit-section-heading">
                <div>
                  <span className="audit-eyebrow">MOTORUL DE OVERWRITE & AUTO-REMEDIERE</span>
                  <h2>Varianta actualizată a site-ului</h2>
                  <p>
                    MarketFixer rescrie automat paginile HTML, corectează meta-tagurile, accesibilitatea,
                    imaginile fără alt și injectează Schema.org pentru motoarele AI.
                  </p>
                </div>
                <button
                  className="button button--green"
                  onClick={generateFixes}
                  disabled={fixing}
                >
                  {fixing ? "Generăm varianta reparată…" : fixes ? "Regenerează designul actualizat →" : "Generează varianta actualizată →"}
                </button>
              </div>

              {fixError && <p className="audit-error" role="alert">{fixError}</p>}

              {fixes && (
                <div className="audit-fixes-content" style={{ marginTop: "1.5rem" }}>
                  <div
                    style={{
                      display: "flex",
                      gap: "1rem",
                      flexWrap: "wrap",
                      marginBottom: "1.5rem",
                    }}
                  >
                    <a
                      className="button button--green"
                      href={`/api${scanPath(id)}/fixes/preview`}
                      target="_blank"
                      rel="noreferrer"
                      style={{ textDecoration: "none" }}
                    >
                      Previzualizează site-ul actualizat live ↗
                    </a>
                    <a
                      className="button button--dark"
                      href={`/api${scanPath(id)}/fixes/download-all`}
                      download
                      style={{ textDecoration: "none" }}
                    >
                      Descarcă toate fișierele (.zip) ↓
                    </a>
                  </div>

                  {fixes.scoresBefore && fixes.scoresAfter && (
                    <div
                      style={{
                        padding: "1rem 1.25rem",
                        background: "rgba(74, 120, 86, 0.08)",
                        borderRadius: "8px",
                        marginBottom: "1.5rem",
                      }}
                    >
                      <strong>Impactul reparațiilor asupra scorului: </strong>
                      <span style={{ fontSize: "1.1rem", fontWeight: "bold", color: "#2e7d32" }}>
                        Scor General: {fixes.scoresBefore.overall}/100 → {fixes.scoresAfter.overall}/100
                        {" "}(+{fixes.scoresAfter.overall - fixes.scoresBefore.overall} pct)
                      </span>
                    </div>
                  )}

                  <h3 style={{ marginBottom: "0.8rem" }}>
                    Pachetul de fișiere gata de descărcat ({fixes.files?.length || 0}):
                  </h3>
                  <div style={{ display: "grid", gap: "0.75rem" }}>
                    {(fixes.files || []).map((file) => (
                      <div
                        key={file.path}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          padding: "0.85rem 1.2rem",
                          background: "#ffffff",
                          border: "1px solid #e2e8f0",
                          borderRadius: "6px",
                        }}
                      >
                        <div>
                          <strong style={{ fontFamily: "monospace" }}>{file.path}</strong>
                          <div style={{ fontSize: "0.85rem", color: "#64748b" }}>
                            {file.description}
                          </div>
                        </div>
                        <a
                          className="button button--dark"
                          style={{
                            fontSize: "0.8rem",
                            padding: "0.4rem 0.8rem",
                            textDecoration: "none",
                          }}
                          href={`/api${scanPath(id)}/fixes/download?path=${encodeURIComponent(file.path)}`}
                          download
                        >
                          Descarcă ↓
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
            <section className="audit-panel">
              <div className="audit-section-heading">
                <div>
                  <span className="audit-eyebrow">PLAN DE ÎMBUNĂTĂȚIRE</span>
                  <h2>Începe cu ce contează</h2>
                </div>
                <span>{report.summary.totalFindings} constatări</span>
              </div>
              <div className="audit-filters">
                <label>
                  Categorie
                  <select
                    aria-label="Categorie"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  >
                    <option value="all">Toate categoriile</option>
                    {Object.entries(categories).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Prioritate
                  <select
                    aria-label="Prioritate"
                    value={level}
                    onChange={(e) => setLevel(e.target.value)}
                  >
                    <option value="all">Toate prioritățile</option>
                    {Object.entries(severity).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {findings.length ? (
                [...findings]
                  .sort(
                    (a, b) =>
                      Object.keys(severity).indexOf(a.severity) -
                      Object.keys(severity).indexOf(b.severity),
                  )
                  .map((f) => <Finding key={f.fingerprint} finding={f} />)
              ) : (
                <p>Nu există constatări pentru selecția curentă.</p>
              )}
            </section>
            {report.limitations?.length > 0 && (
              <section className="audit-panel">
                <h2>Limitele analizei</h2>
                <ul>
                  {report.limitations.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              </section>
            )}
            <div className="audit-columns">
              <section className="audit-panel">
                <span className="audit-eyebrow">EVOLUȚIE</span>
                <h2>Ce s-a schimbat?</h2>
                <label>
                  Compară cu o analiză anterioară
                  <select
                    aria-label="Compară cu o analiză anterioară"
                    value={previous}
                    onChange={(e) => setPrevious(e.target.value)}
                  >
                    <option value="">Alege o scanare</option>
                    {comparable.map((s) => (
                      <option key={s.scanId} value={s.scanId}>
                        {date(s.createdAt)}
                      </option>
                    ))}
                  </select>
                </label>
                {!comparable.length && (
                  <p>
                    Comparația devine disponibilă după două analize finalizate
                    ale aceleiași adrese.
                  </p>
                )}
                {previous && !comparison && (
                  <p role="status">Încărcăm comparația…</p>
                )}
                {comparison?.error && <p role="alert">{comparison.error}</p>}
                {comparison && !comparison.error && (
                  <>
                    <p>
                      {comparison.resolved.length} rezolvate ·{" "}
                      {comparison.new.length} noi ·{" "}
                      {comparison.remaining.length} persistente
                    </p>
                    <ul>
                      {Object.entries(comparison.scoreDelta).map(
                        ([key, value]) => (
                          <li key={key}>
                            {scoreLabels[key] || key}: {value > 0 ? "+" : ""}
                            {value} puncte
                          </li>
                        ),
                      )}
                    </ul>
                    {[
                      ["resolved", "Rezolvate"],
                      ["new", "Noi"],
                      ["remaining", "Persistente"],
                    ].map(([key, label]) => (
                      <details key={key}>
                        <summary>
                          {label} ({comparison[key].length})
                        </summary>
                        <ul>
                          {comparison[key].map((f) => (
                            <li key={f.fingerprint}>
                              {f.title} — {f.evidence.summary}
                            </li>
                          ))}
                        </ul>
                      </details>
                    ))}
                  </>
                )}
              </section>
              <section className="audit-panel">
                <span className="audit-eyebrow">DATELE TALE, ÎN CONTEXT</span>
                <h2>Performanța campaniilor</h2>
                <p>
                  Încarcă un CSV pentru concluzii susținute de datele tale.
                  Maximum 5 MB.
                </p>
                <form onSubmit={upload}>
                  <label>
                    Fișier CSV
                    <input
                      name="file"
                      type="file"
                      accept=".csv,text/csv"
                      required
                      disabled={uploading}
                    />
                  </label>
                  <button className="button button--green" disabled={uploading}>
                    {uploading ? "Analizăm datele…" : "Analizează CSV →"}
                  </button>
                </form>
                {uploadError && <p role="alert">{uploadError}</p>}
                {report.performance && (
                  <div aria-live="polite">
                    <h3>{report.performance.rowCount} rânduri analizate</h3>
                    {report.performance.warnings.map((w, i) => (
                      <p key={i}>{w}</p>
                    ))}
                    {!report.performance.insights.length && (
                      <p>Date insuficiente pentru concluzii comparative.</p>
                    )}
                    {report.performance.insights.map((insight, i) => (
                      <article className="audit-insight" key={i}>
                        <h4>{insight.statement}</h4>
                        <p>Încredere: {severity[insight.confidence]}</p>
                        <p>Indicator: {insight.evidence.metric}</p>
                        <ul>
                          {insight.evidence.groups.map((g, j) => (
                            <li key={j}>
                              {g.name}: n={g.n}, medie {g.mean}, total {g.total}
                            </li>
                          ))}
                        </ul>
                        {insight.caveat && <p>{insight.caveat}</p>}
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </>
        )}
        <section className="audit-panel">
          <div className="audit-section-heading">
            <h2>Istoricul analizelor</h2>
            <button
              onClick={() => {
                setHistoryError("");
                setRetry((n) => n + 1);
              }}
            >
              Actualizează
            </button>
          </div>
          {historyError && <p role="alert">{historyError}</p>}
          {!history.length && <p>Scanările tale vor apărea aici.</p>}
          <ul className="audit-history">
            {history.map((s) => (
              <li key={s.scanId}>
                <button
                  onClick={() => selectScan(s.scanId)}
                  aria-current={id === s.scanId ? "true" : undefined}
                >
                  <strong>{s.url}</strong>
                  <span>{date(s.createdAt)}</span>
                  <span>{statusLabels[s.status]}</span>
                  <span aria-hidden="true">→</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </main>
      <footer className="audit-footer">
        Market Fixer · Recomandări susținute de dovezi
      </footer>
    </div>
  );
}
