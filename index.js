const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
app.use(express.json());

// API endpoint: GET /track?trackingNumber=803315047
app.get('/track', async (req, res) => {
  const trackingNumber = req.query.trackingNumber;

  if (!trackingNumber) {
    return res.status(400).json({ error: 'Missing trackingNumber parameter' });
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();

    // 1. Go to login page
    await page.goto('https://ats.ca/Login?ReturnUrl=%2fprotected%2fATSTrack', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    // 2. Fill login form
    await page.waitForSelector('#ctl10_txtUser', { timeout: 30000 });
    await page.type('#ctl10_txtUser', 'pharplanet', { delay: 50 });
    await page.type('#ctl10_txtPassword', 'ships0624', { delay: 50 });

    // 3. Submit and wait for redirect
    await Promise.all([
      page.click('#ctl10_cmdSubmit'),
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }),
    ]);

    // 4. Go to tracking page
    await page.goto('https://ats.ca/protected/ATSTrack', {
      waitUntil: 'domcontentloaded',
    });

    // 5. Input tracking number
    await page.waitForSelector('#txtShip', { timeout: 20000 });
    await page.type('#txtShip', trackingNumber, { delay: 50 });

    // 6. Trigger search using __doPostBack
    await page.evaluate(() => {
      __doPostBack('btnSearchShip', '');
    });

    // 7. Wait for result
    await new Promise(resolve => setTimeout(resolve, 3000));

    let statusText = null;

    const tableExists = await page.$('#dgPOD');
    if (tableExists) {
      // Extract status from table
      statusText = await page.evaluate(() => {
        const table = document.querySelector('#dgPOD');
        if (!table) return null;

        const headerCells = table.querySelectorAll('tr:first-child td');
        let statusColIndex = -1;

        headerCells.forEach((cell, index) => {
          if (cell.textContent.trim().toLowerCase() === 'status') {
            statusColIndex = index;
          }
        });

        if (statusColIndex === -1) return null;

        const dataRow = table.querySelector('tr:nth-child(2)');
        const dataCells = dataRow.querySelectorAll('td');

        return dataCells[statusColIndex]?.textContent.trim() || null;
      });
    } else {
      // Try reading label message
      const errorTable = await page.$('table');
      if (errorTable) {
        statusText = await page.evaluate(() => {
          const rows = Array.from(document.querySelectorAll('table tr'));
          for (let row of rows) {
            const cells = row.querySelectorAll('td');
            if (cells.length > 1 && cells[0].innerText.trim().match(/^\d{9}$/)) {
              return cells[1].innerText.trim();
            }
          }
          return 'No status or error found';
        });
      }
    }

    await browser.close();

    res.json({
      trackingNumber,
      status: statusText || 'Not found',
    });

  } catch (error) {
    if (browser) await browser.close();
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

const port = process.env.PORT || 8080;
app.listen(port, '0.0.0.0', () => {
  console.log(`✅ API is live at http://0.0.0.0:${port}`);
});
