import express from "express";
import puppeteer from "puppeteer";
import { execSync } from "child_process";

const app = express();
const PORT = process.env.PORT || 10000;

app.get("/health", (_req, res) => res.json({ ok: true }));

async function ensureChromeInstalled() {
  try {
    await puppeteer.launch({ headless: "new" });
  } catch (error) {
    if (error.message.includes('Could not find Chrome')) {
      console.log('Chrome not found, installing...');
      try {
        execSync('npx puppeteer browsers install chrome', { stdio: 'inherit' });
        console.log('Chrome installed successfully');
      } catch (installError) {
        console.error('Failed to install Chrome:', installError.message);
        throw installError;
      }
    } else {
      throw error;
    }
  }
}

async function launchBrowser() {
  const browserConfig = {
    headless: "new",
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--disable-extensions',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding'
    ]
  };

  if (process.env.RENDER || process.env.NODE_ENV === 'production') {
    browserConfig.args.push('--single-process');
  }

  return await puppeteer.launch(browserConfig);
}

app.get("/track", async (req, res) => {
  const trackingNumber = req.query.trackingNumber;
  if (!trackingNumber) {
    return res.status(400).json({ error: "Missing trackingNumber parameter" });
  }

  let browser;
  try {
    // Ensure Chrome is installed before launching
    await ensureChromeInstalled();
    
    browser = await launchBrowser();
    const page = await browser.newPage();

    await page.goto("https://ats.ca/Login?ReturnUrl=%2fprotected%2fATSTrack", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await page.type("#ctl10_txtUser", "pharplanet", { delay: 50 });
    await page.type("#ctl10_txtPassword", "ships0624", { delay: 50 });

    await Promise.all([
      page.click("#ctl10_cmdSubmit"),
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 }),
    ]);

    await page.goto("https://ats.ca/protected/ATSTrack", {
      waitUntil: "domcontentloaded",
    });
    await page.type("#txtShip", trackingNumber, { delay: 50 });

    await page.evaluate(() => __doPostBack("btnSearchShip", ""));
    await page.waitForTimeout(3000);

    let statusText = null;
    const tableExists = await page.$("#dgPOD");

    if (tableExists) {
      statusText = await page.evaluate(() => {
        const table = document.querySelector("#dgPOD");
        const headerCells = table.querySelectorAll("tr:first-child td");
        let statusColIndex = Array.from(headerCells).findIndex(
          cell => cell.textContent.trim().toLowerCase() === "status"
        );
        if (statusColIndex === -1) return null;
        const dataRow = table.querySelector("tr:nth-child(2)");
        return dataRow.querySelectorAll("td")[statusColIndex]?.textContent.trim() || null;
      });
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