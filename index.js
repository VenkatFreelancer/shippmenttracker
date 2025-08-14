import express from "express";
import chromium from "@sparticuz/chrome-aws-lambda";
import puppeteer from "puppeteer-core";

const app = express();
const PORT = process.env.PORT || 10000;

// Simple health check
app.get("/health", (_req, res) => res.json({ ok: true }));

// Helper function to launch the browser
const browser = await puppeteer.launch({
  headless: true,
  executablePath: '/usr/bin/google-chrome', // Or whatever is in your container
});

app.get("/track", async (req, res) => {
  const trackingNumber = req.query.trackingNumber;
  if (!trackingNumber) {
    return res.status(400).json({ error: "Missing trackingNumber parameter" });
  }

  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();

    // Login
    await page.goto("https://ats.ca/Login?ReturnUrl=%2fprotected%2fATSTrack", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await page.waitForSelector("#ctl10_txtUser", { timeout: 30000 });
    await page.type("#ctl10_txtUser", "pharplanet", { delay: 50 });
    await page.type("#ctl10_txtPassword", "ships0624", { delay: 50 });

    await Promise.all([
      page.click("#ctl10_cmdSubmit"),
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 }),
    ]);

    // Track shipment
    await page.goto("https://ats.ca/protected/ATSTrack", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForSelector("#txtShip", { timeout: 20000 });
    await page.type("#txtShip", trackingNumber, { delay: 50 });

    await page.evaluate(() => __doPostBack("btnSearchShip", ""));
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
          if (cell.textContent.trim().toLowerCase() === "status") {
            statusColIndex = i;
          }
        });
        if (statusColIndex === -1) return null;
        const dataRow = table.querySelector("tr:nth-child(2)");
        const dataCells = dataRow.querySelectorAll("td");
        return dataCells[statusColIndex]?.textContent.trim() || null;
      });
    } else {
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
