import express from "express";
import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";

const app = express();
const PORT = process.env.PORT || 10000;

// --- util: locate the Chromium binary inside the cache dir or fallbacks
function findChrome() {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    typeof puppeteer.executablePath === "function" ? puppeteer.executablePath() : null,
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ].filter(Boolean);

  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }

  const cacheDir = process.env.PUPPETEER_CACHE_DIR || "/opt/render/.cache/puppeteer";
  if (fs.existsSync(cacheDir)) {
    const walk = (dir) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          const maybe = walk(full);
          if (maybe) return maybe;
        } else if (e.isFile() && (e.name === "chrome" || e.name === "chromium")) {
          return full;
        }
      }
      return null;
    };
    const found = walk(cacheDir);
    if (found) return found;
  }

  throw new Error(
    `Chrome not found. Checked candidates: ${candidates.join(
      ", "
    )} and cacheDir: ${process.env.PUPPETEER_CACHE_DIR || "/opt/render/.cache/puppeteer"}`
  );
}

// Simple health check so you can see if the server is up
app.get("/health", (_req, res) => res.json({ ok: true }));

// ---- YOUR API ----
app.get("/track", async (req, res) => {
  const trackingNumber = req.query.trackingNumber;
  if (!trackingNumber) {
    return res.status(400).json({ error: "Missing trackingNumber parameter" });
  }

  let browser;
  try {
    const executablePath = findChrome();
    console.log("Resolved Chrome path:", executablePath);

    browser = await puppeteer.launch({
      headless: "new",
      executablePath,
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    const page = await browser.newPage();

    // 1) Login
    await page.goto("https://ats.ca/Login?ReturnUrl=%2fprotected%2fATSTrack", {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await page.waitForSelector("#ctl10_txtUser", { timeout: 30000 });
    await page.type("#ctl10_txtUser", "pharplanet", { delay: 50 });
    await page.type("#ctl10_txtPassword", "ships0624", { delay: 50 });

    await Promise.all([
      page.click("#ctl10_cmdSubmit"),
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 })
    ]);

    // 2) Track
    await page.goto("https://ats.ca/protected/ATSTrack", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#txtShip", { timeout: 20000 });
    await page.type("#txtShip", trackingNumber, { delay: 50 });

    await page.evaluate(() => {
      // ASP.NET postback
      __doPostBack("btnSearchShip", "");
    });

    // Wait a bit for results to render
    await new Promise((r) => setTimeout(r, 3000));

    let statusText = null;

    const tableExists = await page.$("#dgPOD");
    if (tableExists) {
      statusText = await page.evaluate(() => {
        const table = document.querySelector("#dgPOD");
        if (!table) return null;
        const headerCells = table.querySelectorAll("tr:first-child td");
        let statusColIndex = -1;
        headerCells.forEach((cell, i) => {
          if (cell.textContent.trim().toLowerCase() === "status") statusColIndex = i;
        });
        if (statusColIndex === -1) return null;
        const dataRow = table.querySelector("tr:nth-child(2)");
        const dataCells = dataRow.querySelectorAll("td");
        return dataCells[statusColIndex]?.textContent.trim() || null;
      });
    } else {
      // Label created / not picked up yet
      const errorTable = await page.$("table");
      if (errorTable) {
        statusText = await page.evaluate(() => {
          const rows = Array.from(document.querySelectorAll("table tr"));
          for (const row of rows) {
            const cells = row.querySelectorAll("td");
            if (cells.length > 1 && /^\d{9}$/.test(cells[0].innerText.trim())) {
              return cells[1].innerText.trim();
            }
          }
          return "No status or error found";
        });
      }
    }

    await browser.close();
    res.json({ trackingNumber, status: statusText || "Not found" });
  } catch (err) {
    if (browser) await browser.close();
    console.error("Error:", err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.listen(PORT, () => {
  console.log(`✅ API is live at http://0.0.0.0:${PORT}`);
});
