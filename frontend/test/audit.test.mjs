import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { createApp } from "../../backend/src/app.js";

// Run after the production build. Set PLAYWRIGHT_MODULE to an installed Playwright package.
test(
  "landing → scan → report → CSV → comparison, recovery and mobile layout",
  { skip: !process.env.PLAYWRIGHT_MODULE },
  async () => {
    const { chromium } = createRequire(import.meta.url)(
      process.env.PLAYWRIGHT_MODULE,
    );
    const app = createApp({
      dbPath: ":memory:",
      allowPrivate: true,
      contentAi: false,
      runLighthouse: null,
      crawlSite: async (url) => {
        await new Promise((resolve) => setTimeout(resolve, 300));
        return {
          site: {
            rootUrl: url,
            origin: new URL(url).origin,
            robotsTxt: null,
            sitemapUrls: [],
            sitemapFound: false,
            brokenLinks: [],
          },
          pages: [
            {
              url,
              requestedUrl: url,
              status: 200,
              contentType: "text/html",
              headers: {},
              html: '<html lang="ro"><head></head><body><h1>Magazin de test</h1><p>Produse pentru casă.</p></body></html>',
              depth: 0,
              loadMs: 30,
              sizeBytes: 120,
              redirectChain: [],
              links: [],
              fetchedAt: new Date().toISOString(),
            },
          ],
        };
      },
    });
    const server = await new Promise((resolve) => {
      const server = app.listen(0, "127.0.0.1", () => resolve(server));
    });
    let browser;
    try {
      browser = await chromium.launch({ channel: "msedge", headless: true });
      const page = await browser.newPage({
        viewport: { width: 1280, height: 900 },
      });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const base = `http://127.0.0.1:${server.address().port}`;
      await page.goto(base);
      await page.locator("#information").scrollIntoViewIfNeeded();
      await page.waitForTimeout(600);
      await mkdir("test-output", { recursive: true });
      await page
        .locator("#information")
        .screenshot({ path: "test-output/benchmarks.png" });
      const asset = page.locator(".benchmarks__source img");
      assert.equal(
        await asset.evaluate((img) => img.complete && img.naturalWidth > 0),
        true,
      );
      await page.getByLabel("Your website address").fill("https://example.com");
      await page.getByRole("button", { name: "Start analysis" }).click();
      await page
        .getByText("RAPORTUL TĂU", { exact: true })
        .waitFor({ timeout: 30000 });
      const reportUrl = page.url();
      assert.match(reportUrl, /scan=/);
      await page.locator(".audit-finding > summary").first().click();
      assert.ok(
        await page
          .getByRole("heading", { name: "Dovada", exact: true })
          .first()
          .isVisible(),
      );
      await page.getByLabel("Categorie", { exact: true }).selectOption("seo");
      assert.ok((await page.locator(".audit-finding").count()) > 0);
      await page
        .getByLabel("Fișier CSV", { exact: true })
        .setInputFiles({
          name: "campaigns.csv",
          mimeType: "text/csv",
          buffer: Buffer.from("campanie,clicks\nA,10\nA,20\nB,2\nB,4"),
        });
      await page.getByRole("button", { name: "Analizează CSV" }).click();
      await page
        .getByRole("heading", { name: "4 rânduri analizate" })
        .waitFor();
      await page.reload();
      await page
        .getByRole("heading", { name: "4 rânduri analizate" })
        .waitFor();
      await page
        .getByLabel("Adresa site-ului", { exact: true })
        .fill("https://example.com");
      await page.getByRole("button", { name: "Analizează site-ul" }).click();
      await page.waitForURL((url) => url.href !== reportUrl);
      await page.getByText("RAPORTUL TĂU", { exact: true }).waitFor();
      await page.waitForFunction(
        () =>
          document.querySelectorAll(".audit-columns select option").length > 1,
      );
      await page
        .getByLabel("Compară cu o analiză anterioară")
        .selectOption({ index: 1 });
      await page.getByText(/rezolvate · .* noi · .* persistente/).waitFor();
      await page.screenshot({
        path: "test-output/report-desktop.png",
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await page.screenshot({
        path: "test-output/report-mobile.png",
        fullPage: true,
      });
      await page.route("**/api/scans/*", (route) => route.abort());
      await page.reload();
      await page.getByRole("alert").first().waitFor();
      await page.unroute("**/api/scans/*");
      await page.getByRole("button", { name: "Reîncearcă încărcarea" }).click();
      await page.getByText("RAPORTUL TĂU", { exact: true }).waitFor();
      await page.goto(base);
      await page.locator("#information").scrollIntoViewIfNeeded();
      await page.waitForTimeout(600);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await page
        .locator("#information")
        .screenshot({ path: "test-output/benchmarks-mobile.png" });
      assert.deepEqual(errors, []);
    } finally {
      await browser?.close();
      await new Promise((resolve) => server.close(resolve));
      app.locals.db.close();
    }
  },
);
