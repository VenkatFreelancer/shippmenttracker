import express from "express";
import chromium from "@sparticuz/chrome-aws-lambda";
import puppeteer from "puppeteer-core";

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(express.json());

// Health check
app.get("/health", (_req, res) => res.json({ ok: true }));

// Browser launcher with improved error handling
async function launchBrowser() {
  try {
    let executablePath;
    let args = [];

    // Check if running in AWS Lambda or similar cloud environment
    if (process.env.AWS_EXECUTION_ENV || process.env.AWS_LAMBDA_FUNCTION_NAME) {
      executablePath = await chromium.executablePath();
      args = chromium.args;
    } else {
      // Local development paths
      if (process.platform === "win32") {
        executablePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
      } else if (process.platform === "darwin") {
        executablePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
      } else {
        // Linux fallbacks
        const possiblePaths = [
          "/usr/bin/google-chrome",
          "/usr/bin/google-chrome-stable",
          "/usr/bin/chromium-browser",
          "/snap/bin/chromium"
        ];
        
        for (const path of possiblePaths) {
          try {
            const fs = await import('fs');
            if (fs.existsSync(path)) {
              executablePath = path;
              break;
            }
          } catch (e) {
            // Continue checking other paths
          }
        }
      }
      
      // Local development args
      args = [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-web-security",
        "--disable-features=VizDisplayCompositor",
        "--single-process"
      ];
    }

    if (!executablePath) {
      throw new Error("Chrome executable not found. Please install Chrome or Chromium.");
    }

    console.log(`Launching browser with executable: ${executablePath}`);

    return await puppeteer.launch({
      args: args,
      defaultViewport: chromium.defaultViewport || { width: 1280, height: 720 },
      executablePath,
      headless: true, // Always use headless mode
      ignoreDefaultArgs: ['--disable-extensions'],
      timeout: 30000
    });
  } catch (error) {
    console.error("Failed to launch browser:", error);
    throw new Error(`Browser launch failed: ${error.message}`);
  }
}

app.get("/track", async (req, res) => {
  const trackingNumber = req.query.trackingNumber;
  
  if (!trackingNumber) {
    return res.status(400).json({ error: "Missing trackingNumber parameter" });
  }

  // Validate tracking number format (adjust regex as needed)
  if (!/^\d{9,}$/.test(trackingNumber)) {
    return res.status(400).json({ error: "Invalid tracking number format" });
  }

  let browser;
  let page;
  
  try {
    console.log(`Processing tracking number: ${trackingNumber}`);
    
    browser = await launchBrowser();
    page = await browser.newPage();
    
    // Set user agent to avoid detection
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    
    // Set viewport
    await page.setViewport({ width: 1280, height: 720 });
    
    console.log("Navigating to login page...");
    
    // Login page with better error handling
    const loginResponse = await page.goto("https://ats.ca/Login?ReturnUrl=%2fprotected%2fATSTrack", {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    
    if (!loginResponse.ok()) {
      throw new Error(`Login page returned ${loginResponse.status()}`);
    }

    // Wait for login form elements
    await page.waitForSelector("#ctl10_txtUser", { timeout: 10000 });
    await page.waitForSelector("#ctl10_txtPassword", { timeout: 10000 });
    
    console.log("Entering credentials...");
    
    // Clear fields first
    await page.click("#ctl10_txtUser", { clickCount: 3 });
    await page.type("#ctl10_txtUser", "pharplanet", { delay: 50 });
    
    await page.click("#ctl10_txtPassword", { clickCount: 3 });
    await page.type("#ctl10_txtPassword", "ships0624", { delay: 50 });

    console.log("Submitting login form...");
    
    // Submit login form
    await page.waitForSelector("#ctl10_cmdSubmit", { timeout: 5000 });
    
    await Promise.all([
      page.click("#ctl10_cmdSubmit"),
      page.waitForNavigation({ 
        waitUntil: "domcontentloaded", 
        timeout: 30000 
      }),
    ]);

    console.log("Navigating to tracking page...");
    
    // Navigate to tracking page
    const trackingResponse = await page.goto("https://ats.ca/protected/ATSTrack", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    
    if (!trackingResponse.ok()) {
      throw new Error(`Tracking page returned ${trackingResponse.status()}`);
    }
    
    // Wait for and enter tracking number
    await page.waitForSelector("#txtShip", { timeout: 10000 });
    await page.click("#txtShip", { clickCount: 3 });
    await page.type("#txtShip", trackingNumber, { delay: 50 });

    console.log("Searching for tracking information...");
    
    // Submit tracking search
    await page.evaluate(() => {
      if (typeof __doPostBack === 'function') {
        __doPostBack("btnSearchShip", "");
      } else {
        // Fallback: try to click the search button directly
        const btn = document.querySelector('input[id*="btnSearchShip"]');
        if (btn) btn.click();
      }
    });
    
    // Wait for results with multiple strategies
    await Promise.race([
      page.waitForSelector("#dgPOD", { timeout: 5000 }).catch(() => null),
      page.waitForSelector("table", { timeout: 5000 }).catch(() => null),
      page.waitForTimeout(3000)
    ]);

    let statusText = null;

    console.log("Extracting status information...");

    // Try to find status in dgPOD table
    const dgPODExists = await page.$("#dgPOD");
    if (dgPODExists) {
      statusText = await page.evaluate(() => {
        const table = document.querySelector("#dgPOD");
        if (!table) return null;
        
        const headers = Array.from(table.querySelectorAll("tr:first-child td"));
        const statusIndex = headers.findIndex(
          (cell) => cell.textContent.trim().toLowerCase().includes("status")
        );
        
        if (statusIndex === -1) return null;
        
        const dataRow = table.querySelector("tr:nth-child(2)");
        const statusCell = dataRow?.querySelectorAll("td")[statusIndex];
        return statusCell?.textContent.trim() || null;
      });
    }
    
    // Fallback: look in any table for tracking number
    if (!statusText) {
      statusText = await page.evaluate((trackNum) => {
        const tables = document.querySelectorAll("table");
        
        for (const table of tables) {
          const rows = Array.from(table.querySelectorAll("tr"));
          for (const row of rows) {
            const cells = row.querySelectorAll("td");
            if (cells.length > 1) {
              const firstCellText = cells[0].textContent.trim();
              if (firstCellText === trackNum || /^\d{9,}$/.test(firstCellText)) {
                return cells[1].textContent.trim();
              }
            }
          }
        }
        
        // Look for error messages
        const errorElements = document.querySelectorAll('[id*="error"], [class*="error"], .alert, .message');
        for (const elem of errorElements) {
          const text = elem.textContent.trim();
          if (text) return `Error: ${text}`;
        }
        
        return null;
      }, trackingNumber);
    }

    console.log(`Status found: ${statusText}`);
    
    res.json({ 
      trackingNumber, 
      status: statusText || "No status information found",
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error("Tracking error:", err);
    
    // Try to get more specific error information
    let errorDetails = err.message;
    if (page) {
      try {
        const pageTitle = await page.title();
        const currentUrl = page.url();
        errorDetails += ` | Page: ${pageTitle} | URL: ${currentUrl}`;
      } catch (e) {
        // Ignore page info errors
      }
    }
    
    res.status(500).json({ 
      error: "Tracking failed", 
      details: errorDetails,
      trackingNumber 
    });
  } finally {
    // Ensure cleanup
    if (page) {
      try {
        await page.close();
      } catch (e) {
        console.error("Error closing page:", e);
      }
    }
    
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        console.error("Error closing browser:", e);
      }
    }
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ API is live at http://0.0.0.0:${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Platform: ${process.platform}`);
});