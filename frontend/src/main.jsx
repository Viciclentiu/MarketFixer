import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import cursors from "./assets/cursors.svg";
import preview from "./assets/website-preview.svg";
import google from "./assets/google.svg";
import wrench from "./assets/wrench.svg";
import connections from "./assets/connections.png";
import journey from "./assets/journey.png";
import journeyTrack from "./assets/journey-track.svg";
import heroIllustration from "./assets/hero-illustration-transparent.png";
import globe from "./assets/globe.svg";
import sparkle from "./assets/sparkle.svg";
import fileText from "./assets/file-text.svg";
import ellipse4 from "./assets/ellipse4.svg";
import ellipse5 from "./assets/ellipse5.svg";
import "./sass/main.scss";
import Audit from "./Audit";
import info from "./assets/info.svg";
import { request } from "./api";

const Arrow = () => <span aria-hidden="true">→</span>;
function Logo() {
  return (
    <a className="logo" href="#analyze">
      <span className="logo__wordmark">
        market <span>fixer</span>
      </span>
      <img src={wrench} alt="" />
    </a>
  );
}
function App() {
  const [url, setUrl] = useState("");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reducedMotion.matches || !("IntersectionObserver" in window)) return;

    const elements = document.querySelectorAll("[data-reveal]");
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("reveal--visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1 },
    );

    elements.forEach((element) => {
      // Content already visible stays visible when the page loads or is restored.
      if (element.getBoundingClientRect().top >= window.innerHeight) {
        element.classList.add("reveal", "reveal--pending");
        observer.observe(element);
      }
    });
    return () => observer.disconnect();
  }, []);
  async function submit(event) {
    event.preventDefault();
    if (starting) return;
    setStarting(true);
    setStartError("");
    try {
      const scan = await request('/scans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: url.trim() }) });
      window.location.assign(`/?view=audit&scan=${encodeURIComponent(scan.scanId)}`);
    } catch (error) {
      setStartError(error.message);
      setStarting(false);
    }
  }
  const areas = [
    ["01", "SEO & AEO", "Structure and visibility"],
    ["02", "Performance", "Speed and stability"],
    ["03", "Accessibility", "For every visitor"],
    ["04", "UX & clarity", "Journey and communication"],
  ];
  const steps = [
    [
      globe,
      "Start",
      "Add your website",
      "Paste the link. There is nothing to install and no brief to prepare.",
    ],
    [
      sparkle,
      "AI analysis",
      "We understand the context",
      "We review technology, content, and experience together rather than as isolated checks.",
    ],
    [
      fileText,
      "Fast feedback",
      "Know what to do next",
      "Get clear priorities, short explanations, and one concrete action for every issue.",
    ],
  ];
  return (
    <>
      <header className="header">
        <div className="container navigation">
          <Logo />
          <nav aria-label="Main navigation">
            <a href="#analyze">Analyze</a>
            <a href="#process">Process</a>
            <a href="#information">Information</a>
          </nav>
          <a className="button button--dark button--nav" href="#analyze">
            Analyze your website <Arrow />
          </a>
        </div>
      </header>
      <main>
        <section className="hero container" id="analyze">
          <img className="hero__cursors" src={cursors} alt="" />
          <div className="hero__content">
            <h1>
              Make your online
              <br />
              presence more
              <br />
              <em>relevant.</em>
            </h1>
            <p>
              See what slows your website down, what fails to convince your
              audience, and what is worth changing - in one clear,
              evidence-based report.
            </p>
            <form onSubmit={submit}>
              <label htmlFor="website">Your website address</label>
              <div className="hero__input-box">
                <span aria-hidden="true">◎</span>
                <input
                  id="website"
                  type="url"
                  required
                  placeholder="https://your-website.com"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
                <button className="button button--green" type="submit" disabled={starting}>
                  {starting ? 'Starting…' : 'Start analysis'} <Arrow />
                </button>
              </div>
            </form>
            {startError && <p className="audit-error" role="alert">{startError}</p>}
            <small>
              ♧ &nbsp; We only scan public pages. No card. No account access.
            </small>
          </div>
          <div className="hero__art">
            <div className="hero__orbit" />
            <img
              className="hero__illustration"
              src={heroIllustration}
              alt="Example website audit showing scores and an improvement opportunity"
            />
          </div>
        </section>
        <section className="perspective">
          <div className="container">
            <h2 data-reveal>We see your website as a whole.</h2>
            <div className="perspective__grid" data-reveal>
              <div className="perspective__area-column perspective__area-column--left">
                {areas.slice(0, 2).map((a) => (
                  <div className="perspective__area" key={a[0]}>
                    <span>{a[0]}</span>
                    <h3>{a[1]}</h3>
                    <p>{a[2]}</p>
                  </div>
                ))}
              </div>
              <div className="perspective__visual">
                <img
                  className="perspective__connections"
                  src={connections}
                  alt=""
                />
                <img
                  className="perspective__site-preview"
                  src={preview}
                  alt=""
                />
              </div>
              <div className="perspective__area-column">
                {areas.slice(2).map((a) => (
                  <div className="perspective__area" key={a[0]}>
                    <span>{a[0]}</span>
                    <h3>{a[1]}</h3>
                    <p>{a[2]}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
        <section className="process" id="process">
          <img
            className="process__decoration process__decoration--top"
            src={ellipse4}
            alt=""
          />
          <img
            className="process__decoration process__decoration--bottom"
            src={ellipse5}
            alt=""
          />
          <div className="container">
            <h2 data-reveal>
              A simple path from your website to better decisions.
            </h2>
            <p className="process__intro" data-reveal>
              Show us where you are. Market Fixer guides you toward what is
              actually worth changing.
            </p>
            <div className="process__steps" data-reveal>
              <img
                className="process__journey process__journey--track"
                src={journeyTrack}
                alt=""
              />
              <img
                className="process__journey process__journey--path"
                src={journey}
                alt=""
              />
              {steps.map((s, i) => (
                <article className="process__step" key={s[1]}>
                  <div className="process__step-icon">
                    <img src={s[0]} alt="" />
                    <span>{i + 1}</span>
                  </div>
                  <b>{s[1]}</b>
                  <h3>{s[2]}</h3>
                  <p>{s[3]}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
        <section className="google">
          <div className="google__inner" data-reveal>
            <div className="google__tile">
              <img src={google} alt="Google" />
            </div>
            <div>
              <h2>
                Market Fixer follows Google’s official search recommendations.
              </h2>
              <a
                href="https://developers.google.com/search/docs/fundamentals/creating-helpful-content"
                target="_blank"
                rel="noreferrer"
              >
                View the guidelines <Arrow />
              </a>
            </div>
          </div>
        </section>
        <section className="services benchmarks" id="information">
          <div className="container">
            <h2 data-reveal>96.55% of pages get zero organic search traffic</h2>
            <div className="benchmarks__card" data-reveal>
              <h3>Why most sites stay invisible</h3>
              <div className="benchmarks__chart">
                {[
                  [96.55, "Pages with zero Google traffic"],
                  [96.60, "Google clicks going to Page 1 only"],
                  [68, "Small business sites lacking basic SEO"],
                  [55.60, "Small businesses with zero SEO budget"],
                ].map(([value, label], index) => (
                  <div className="benchmarks__item" key={label}>
                    <div className="benchmarks__track"><div className={'benchmarks__bar benchmarks__bar--' + index} style={{height: value + '%'}}><strong>{value.toFixed(2)}%</strong></div></div>
                    <p>{label}</p>
                  </div>
                ))}
              </div>
              <p className="benchmarks__source"><img src={info} alt="" />Ahrefs study of 1 Billion pages &amp; Small Business Marketing Benchmarks</p>
            </div>
          </div>
        </section>
        <section className="cta container" data-reveal>
          <h2>Ready to see what your website is missing?</h2>
          <a className="button button--dark" href="#analyze">
            Start now <Arrow />
          </a>
        </section>
      </main>
      <footer>
        <div className="container footer">
          <Logo />
          <nav>
            <a href="#process">Process</a>
            <a href="#information">Services</a>
            <a href="/?view=audit">Reports</a>
          </nav>
          <small>© 2025 Market Fixer · Demo product</small>
        </div>
      </footer>
    </>
  );
}

const query = new URLSearchParams(window.location.search);
const isAudit = query.get("view") === "audit" || query.has("scan");
createRoot(document.getElementById("root")).render(isAudit ? <Audit /> : <App />);
