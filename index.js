// index.js
import express from "express";
import dotenv from "dotenv";


dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;

// --- helpers
function requiredEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

console.log("Env loaded:", {
  token: process.env.BROWSERLESS_TOKEN ? "✅ exists" : "❌ missing",
  user: process.env.ATS_USER,
});


/**
 * Calls Browserless `/function` API and runs a headless-chrome script remotely.
 * We pass in our ATS creds + tracking number via "context".
 */
async function runInBrowserless({ trackingNumber }) {
  const token = requiredEnv("BROWSERLESS_TOKEN");
  const ATS_USER = requiredEnv("ATS_USER");
  const ATS_PASS = requiredEnv("ATS_PASS");

  // This function body runs on Browserless. Keep it self-contained!
  const code = `
    // This code runs inside Browserless
    module.exports = async ({ page, context }) => {
      const { ATS_USER, ATS_PASS, trackingNumber } = context;

      // Be conservative with resources/time
      page.setDefaultTimeout(25000);
      page.setDefaultNavigationTimeout(25000);

      // Block heavy resources
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const rt = req.resourceType();
        if (['image','stylesheet','font','media'].includes(rt)) req.abort();
        else req.continue();
      });

      // Login
      await page.goto('https://ats.ca/Login?ReturnUrl=%2fprotected%2fATSTrack', {
        waitUntil: 'domcontentloaded'
      });

      await page.waitForSelector('#ctl10_txtUser', { timeout: 15000 });
      await page.type('#ctl10_txtUser', ATS_USER, { delay: 25 });
      await page.type('#ctl10_txtPassword', ATS_PASS, { delay: 25 });

      await Promise.all([
        page.click('#ctl10_cmdSubmit'),
        page.waitForNavigation({ waitUntil: 'domcontentloaded' })
      ]);

      // Track page
      await page.goto('https://ats.ca/protected/ATSTrack', { waitUntil: 'domcontentloaded' });

      await page.waitForSelector('#txtShip', { timeout: 15000 });
      await page.evaluate(() => (document.querySelector('#txtShip').value = ''));
      await page.type('#txtShip', trackingNumber, { delay: 25 });

      // ASP.NET postback
      await page.evaluate(() => { window.__doPostBack && __doPostBack('btnSearchShip', ''); });

      // Wait a moment for table render
      await page.waitForTimeout(3000);

      // Try to read table
      let statusText = null;
      const table = await page.$('#dgPOD');
      if (table) {
        statusText = await page.evaluate(() => {
          const t = document.querySelector('#dgPOD');
          if (!t) return null;
          const headerCells = t.querySelectorAll('tr:first-child td');
          let statusIdx = -1;
          headerCells.forEach((cell, i) => {
            if (cell.textContent.trim().toLowerCase() === 'status') statusIdx = i;
          });
          if (statusIdx === -1) return null;
          const dataRow = t.querySelector('tr:nth-child(2)');
          if (!dataRow) return null;
          const cells = dataRow.querySelectorAll('td');
          return (cells[statusIdx]?.textContent || '').trim() || null;
        });
      } else {
        // Fallback: sometimes the page shows a 2-col table with "trackingNumber | message"
        statusText = await page.evaluate(() => {
          const rows = Array.from(document.querySelectorAll('table tr'));
          for (const row of rows) {
            const cells = row.querySelectorAll('td');
            if (cells.length > 1 && /^\\d{9}$/.test(cells[0].innerText.trim())) {
              return cells[1].innerText.trim();
            }
          }
          return null;
        });
      }

      return {
        status: statusText || 'Not found'
      };
    };
  `;

  const body = {
    code,
    context: { ATS_USER, ATS_PASS, trackingNumber }
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000); // 30s hard timeout

  const res = await fetch(`https://chrome.browserless.io/function?token=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: controller.signal
  }).catch((e) => {
    throw new Error(`Browserless request failed: ${e.message}`);
  });

  clearTimeout(timeout);

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Browserless error ${res.status}: ${text || res.statusText}`);
  }

  // Browserless returns JSON with the value you `return`ed as { data: ... }
  const json = await res.json();
  // Defensive: Browserless commonly returns { data, logs, ... }
  return json?.data || json;
}

// --- routes

app.get("/health", (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

app.get("/track", async (req, res) => {
  const trackingNumber = String(req.query.trackingNumber || "").trim();

  if (!trackingNumber) {
    return res.status(400).json({ error: "Missing trackingNumber parameter" });
  }

  const started = Date.now();
  try {
    const data = await runInBrowserless({ trackingNumber });
    res.json({
      trackingNumber,
      status: data.status || "Not found",
      durationMs: Date.now() - started
    });
  } catch (err) {
    res.status(500).json({
      error: err.message || String(err),
      trackingNumber,
      durationMs: Date.now() - started
    });
  }
});

// --- server
app.listen(PORT, () => {
  console.log(`✅ API is live at http://0.0.0.0:${PORT}`);
});
