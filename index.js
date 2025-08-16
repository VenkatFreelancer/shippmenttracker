import express from "express";
import chromium from "chrome-aws-lambda";
import puppeteer from "puppeteer-core";

const app = express();
const PORT = process.env.PORT || 10000;

app.get("/health", (_req, res) => res.json({ ok: true }));

async function launchBrowser() {
  return await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath,
    headless: chromium.headless,
    ignoreHTTPSErrors: true,
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