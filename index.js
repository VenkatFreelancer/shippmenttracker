import express from "express";
import chromium from "@sparticuz/chrome-aws-lambda";
import puppeteer from "puppeteer-core";

const app = express();
const PORT = process.env.PORT || 10000;

// Health check
app.get("/health", (_req, res) => res.json({ ok: true }));

// Browser launcher
async function launchBrowser() {
  let executablePath;

  // ✅ Always await chromium.executablePath() — it returns a Promise
  if (typeof chromium.executablePath === "function") {
    executablePath = await chromium.executablePath();
  } else {
    executablePath = chromium.executablePath;
  }

  // Local dev fallback
  if (!executablePath) {
    if (process.platform === "win32") {
      executablePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
    } else if (process.platform === "darwin") {
      executablePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    } else {
      executablePath = "/usr/bin/google-chrome";
    }
  }

  return puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath,
    headless: chromium.headless,
  });
}

app.get("/track", async (req, res) => {
  const trackingNumber = req.query.trackingNumber;
  if (!trackingNumber) {
    return res.status(400).json({ error: "Missing trackingNumber parameter" });
  }

  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();

    // Login page — use 'networkidle2' for faster readiness
    await page.goto("https://ats.ca/Login?ReturnUrl=%2fprotected%2fATSTrack", {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

    await page.type("#ctl10_txtUser", "pharplanet", { delay: 30 });
    await page.type("#ctl10_txtPassword", "ships0624", { delay: 30 });

    await Promise.all([
      page.click("#ctl10_cmdSubmit"),
      page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }),
    ]);

    // Tracking page
    await page.goto("https://ats.ca/protected/ATSTrack", {
      waitUntil: "networkidle2",
      timeout: 20000,
    });
    await page.type("#txtShip", trackingNumber, { delay: 30 });

    await page.evaluate(() => __doPostBack("btnSearchShip", ""));
    await page.waitForTimeout(2000); // small wait, not 3+ seconds

    let statusText = null;

    if (await page.$("#dgPOD")) {
      statusText = await page.evaluate(() => {
        const table = document.querySelector("#dgPOD");
        if (!table) return null;
        const headers = Array.from(table.querySelectorAll("tr:first-child td"));
        const statusIndex = headers.findIndex(
          (cell) => cell.textContent.trim().toLowerCase() === "status"
        );
        if (statusIndex === -1) return null;
        const dataRow = table.querySelector("tr:nth-child(2)");
        return dataRow?.querySelectorAll("td")[statusIndex]?.textContent.trim() || null;
      });
    } else if (await page.$("table")) {
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

    await browser.close();
    res.json({ trackingNumber, status: statusText || "Not found" });
  } catch (err) {
    if (browser) await browser.close();
    console.error("Error:", err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`✅ API is live at http://0.0.0.0:${PORT}`);
});
