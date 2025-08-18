import express from "express";
import puppeteer from "puppeteer";

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());

// Global browser instance management
let globalBrowser = null;
let browserPromise = null;

// Graceful shutdown handling
process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, shutting down gracefully...');
  await cleanup();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('Received SIGINT, shutting down gracefully...');
  await cleanup();
  process.exit(0);
});

async function cleanup() {
  if (globalBrowser) {
    try {
      await globalBrowser.close();
      console.log('Browser closed successfully');
    } catch (error) {
      console.error('Error closing browser:', error);
    }
    globalBrowser = null;
  }
}

async function getBrowser() {
  if (globalBrowser && globalBrowser.isConnected()) {
    return globalBrowser;
  }

  // Clean up disconnected browser
  if (globalBrowser) {
    try {
      await globalBrowser.close();
    } catch (e) {
      console.log('Cleaned up disconnected browser');
    }
    globalBrowser = null;
  }

  // If browser creation is already in progress, wait for it
  if (browserPromise) {
    return await browserPromise;
  }

  browserPromise = launchBrowser();
  try {
    globalBrowser = await browserPromise;
    browserPromise = null;
    return globalBrowser;
  } catch (error) {
    browserPromise = null;
    throw error;
  }
}

async function launchBrowser() {
  console.log('Launching browser for Docker environment...');
  
  const browserConfig = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process', // Critical for Docker
      '--disable-gpu',
      '--disable-extensions',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-sync',
      '--metrics-recording-only',
      '--no-crash-upload',
      '--disable-crash-reporter',
      '--memory-pressure-off',
      '--max_old_space_size=512'
    ]
  };

  // Try different Chrome/Chromium paths
  const chromePaths = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/local/bin/chromium',
    '/opt/google/chrome/chrome'
  ].filter(Boolean); // Remove undefined values

  console.log('Trying Chrome paths:', chromePaths);

  for (const executablePath of chromePaths) {
    try {
      console.log(`Attempting to launch browser at: ${executablePath}`);
      
      const browser = await puppeteer.launch({
        ...browserConfig,
        executablePath
      });
      
      console.log(`Browser launched successfully at: ${executablePath}`);
      
      // Test browser connection
      const page = await browser.newPage();
      await page.close();
      
      return browser;
    } catch (error) {
      console.log(`Failed to launch browser at ${executablePath}: ${error.message}`);
      continue;
    }
  }

  // If all executable paths fail, try without specifying executablePath (use bundled Chromium)
  console.log('All Chrome paths failed, trying bundled Chromium...');
  try {
    const browser = await puppeteer.launch(browserConfig);
    console.log('Browser launched successfully with bundled Chromium');
    
    // Test browser connection
    const page = await browser.newPage();
    await page.close();
    
    return browser;
  } catch (error) {
    console.error('Failed to launch browser with bundled Chromium:', error);
    throw error;
  }
}

app.get("/health", (_req, res) => {
  res.json({ 
    ok: true, 
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV,
    pid: process.pid
  });
});

app.get("/track", async (req, res) => {
  const trackingNumber = req.query.trackingNumber;
  if (!trackingNumber) {
    return res.status(400).json({ error: "Missing trackingNumber parameter" });
  }

  let page = null;
  const startTime = Date.now();
  const requestId = Math.random().toString(36).substring(7);
  
  try {
    console.log(`[${requestId}] Starting tracking for: ${trackingNumber}`);
    
    const browser = await getBrowser();
    page = await browser.newPage();

    // Set resource limits for Docker
    await page.setDefaultTimeout(25000);
    await page.setDefaultNavigationTimeout(25000);
    
    // Block unnecessary resources to save memory in Docker
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const resourceType = req.resourceType();
      if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    // Reduced viewport for Docker memory constraints
    await page.setViewport({ width: 1024, height: 768 });
    await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');

    console.log(`[${requestId}] Navigating to login page...`);
    await page.goto("https://ats.ca/Login?ReturnUrl=%2fprotected%2fATSTrack", {
      waitUntil: "domcontentloaded",
      timeout: 25000,
    });

    console.log(`[${requestId}] Entering credentials...`);
    await page.waitForSelector("#ctl10_txtUser", { timeout: 10000 });
    await page.type("#ctl10_txtUser", "pharplanet", { delay: 25 });
    await page.type("#ctl10_txtPassword", "ships0624", { delay: 25 });

    console.log(`[${requestId}] Logging in...`);
    await Promise.all([
      page.click("#ctl10_cmdSubmit"),
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 25000 }),
    ]);

    console.log(`[${requestId}] Navigating to tracking page...`);
    await page.goto("https://ats.ca/protected/ATSTrack", {
      waitUntil: "domcontentloaded",
      timeout: 25000,
    });
    
    console.log(`[${requestId}] Entering tracking number...`);
    await page.waitForSelector("#txtShip", { timeout: 10000 });
    
    // Clear field and enter tracking number
    await page.evaluate(() => document.querySelector("#txtShip").value = "");
    await page.type("#txtShip", trackingNumber, { delay: 25 });

    console.log(`[${requestId}] Searching...`);
    await page.evaluate(() => __doPostBack("btnSearchShip", ""));
    
    // Wait for results
    console.log(`[${requestId}] Waiting for results...`);
    let statusText = null;
    
    try {
      await page.waitForSelector("#dgPOD", { timeout: 8000 });
      console.log(`[${requestId}] Results table found`);
      
      statusText = await page.evaluate(() => {
        const table = document.querySelector("#dgPOD");
        if (!table) return null;
        
        const headerCells = table.querySelectorAll("tr:first-child td");
        let statusColIndex = Array.from(headerCells).findIndex(
          cell => cell.textContent.trim().toLowerCase() === "status"
        );
        
        if (statusColIndex === -1) return null;
        
        const dataRow = table.querySelector("tr:nth-child(2)");
        if (!dataRow) return null;
        
        const statusCell = dataRow.querySelectorAll("td")[statusColIndex];
        return statusCell?.textContent.trim() || null;
      });
    } catch (timeoutError) {
      console.log(`[${requestId}] No results found within timeout`);
    }

    // Close the page immediately
    await page.close();
    page = null;
    
    const duration = Date.now() - startTime;
    const result = statusText || "Not found";
    
    console.log(`[${requestId}] Completed in ${duration}ms: ${result}`);
    
    res.json({ 
      trackingNumber, 
      status: result,
      duration: `${duration}ms`,
      requestId
    });

  } catch (err) {
    console.error(`[${requestId}] Error:`, err.message);
    
    if (page) {
      try {
        await page.close();
      } catch (closeErr) {
        console.error(`[${requestId}] Error closing page:`, closeErr.message);
      }
    }
    
    res.status(500).json({ 
      error: err.message,
      trackingNumber,
      requestId,
      timestamp: new Date().toISOString()
    });
  }
});

// Browser detection endpoint
app.get("/detect-browser", async (req, res) => {
  const fs = await import('fs');
  
  const chromePaths = [
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/local/bin/chromium',
    '/opt/google/chrome/chrome'
  ];

  const detectedPaths = [];
  
  for (const path of chromePaths) {
    try {
      if (fs.existsSync(path)) {
        detectedPaths.push({
          path,
          exists: true
        });
      } else {
        detectedPaths.push({
          path,
          exists: false
        });
      }
    } catch (error) {
      detectedPaths.push({
        path,
        exists: false,
        error: error.message
      });
    }
  }

  res.json({
    environment: process.env.NODE_ENV,
    puppeteerExecutablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
    detectedPaths,
    platform: process.platform,
    arch: process.arch
  });
});

// Docker health check endpoint
app.get("/browser-test", async (req, res) => {
  let page = null;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    
    await page.goto('data:text/html,<html><body><h1>Test</h1></body></html>', { 
      waitUntil: 'domcontentloaded',
      timeout: 10000 
    });
    
    const title = await page.$eval('h1', el => el.textContent);
    await page.close();
    
    res.json({ 
      success: true, 
      title,
      message: "Browser test successful in Docker",
      browserConnected: browser.isConnected()
    });
  } catch (error) {
    if (page) {
      try {
        await page.close();
      } catch (e) {
        console.error('Error closing test page:', e.message);
      }
    }
    res.status(500).json({ 
      success: false, 
      error: error.message,
      message: "Browser test failed in Docker" 
    });
  }
});

// Detailed status for Docker monitoring
app.get("/status", async (req, res) => {
  const memUsage = process.memoryUsage();
  res.json({
    status: "running",
    environment: "docker",
    uptime: `${Math.floor(process.uptime())}s`,
    memory: {
      rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`,
      heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
      heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
      external: `${Math.round(memUsage.external / 1024 / 1024)}MB`
    },
    browserConnected: globalBrowser?.isConnected() || false,
    chromeVersion: process.env.PUPPETEER_EXECUTABLE_PATH,
    timestamp: new Date().toISOString(),
    pid: process.pid
  });
});

// Graceful server shutdown
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Docker API is live at http://0.0.0.0:${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV}`);
  console.log(`Chrome path: ${process.env.PUPPETEER_EXECUTABLE_PATH}`);
  console.log(`Process ID: ${process.pid}`);
});

server.on('close', async () => {
  console.log('HTTP server closed, cleaning up...');
  await cleanup();
});