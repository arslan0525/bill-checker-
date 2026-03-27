// ============================================================
// MEPCO Bill Checker - Backend Server (v2 - Complete Rewrite)
// ============================================================
// Tech Stack: Node.js + Express + Puppeteer
// Target: https://bill.pitc.com.pk/mepcobill
// Endpoint: POST /get-bill
// Returns:  { success, image (base64 PNG) }
// ============================================================

const express  = require('express');
const cors     = require('cors');
const path     = require('path');

let puppeteer;
let sparticuzChromium;

// Check if we are running in a Vercel/serverless environment
const isVercel = process.env.VERCEL || process.env.VERCEL_ENV;

if (isVercel) {
  puppeteer = require('puppeteer-core');
  sparticuzChromium = require('@sparticuz/chromium');
} else {
  puppeteer = require('puppeteer');
}

const app  = express();
const PORT = 3000;

// ── Middleware ───────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Coloured step logger ─────────────────────────────────────
function log(step, msg) {
  const t = new Date().toLocaleTimeString();
  const prefix = (step === 'ERR') ? '\x1b[31m[ERROR]\x1b[0m'
               : (step === 'OK')  ? '\x1b[32m[  OK ]\x1b[0m'
               : `\x1b[36m[STEP ${step}]\x1b[0m`;
  console.log(`${prefix} [${t}] ${msg}`);
}

// ── API Endpoint: Fetch Bill ─────────────────────────────────
app.post('/get-bill', async (req, res) => {
  const { searchType, searchValue } = req.body;

  // ── Input Validation ──
  log(1, `Request → type: ${searchType}, value: ${searchValue}`);

  if (!searchValue) {
    log('ERR', 'Validation failed: Missing search value.');
    return res.status(400).json({ success: false, error: 'Please provide a reference number or consumer ID.' });
  }

  const isNumeric = /^\d+$/.test(searchValue);
  if (!isNumeric) {
    log('ERR', 'Validation failed: Search value is not numeric.');
    return res.status(400).json({ success: false, error: 'Input must contain only numbers.' });
  }

  if (searchType === 'refno' && searchValue.length !== 14) {
    log('ERR', `Validation failed: Reference Number must be 14 digits (got ${searchValue.length}).`);
    return res.status(400).json({ success: false, error: 'Reference Number must be exactly 14 digits.' });
  }
  
  if (searchType === 'appno' && searchValue.length !== 10) {
    log('ERR', `Validation failed: Customer ID must be 10 digits (got ${searchValue.length}).`);
    return res.status(400).json({ success: false, error: 'Customer ID must be exactly 10 digits.' });
  }

  const displayId = searchType === 'refno' ? `Ref: ${searchValue}` : `ID: ${searchValue}`;
  let browser = null;

  try {
    // ── STEP 2 ─ Launch browser ──────────────────────────
    log(2, 'Launching headless Chromium browser...');

    if (isVercel) {
      log(2, 'Using @sparticuz/chromium for Vercel serverless environment...');
      // Optional: adjust graphics depending on limits
      sparticuzChromium.setGraphicsMode = false;
      
      browser = await puppeteer.launch({
        args: sparticuzChromium.args,
        defaultViewport: sparticuzChromium.defaultViewport,
        executablePath: await sparticuzChromium.executablePath(),
        headless: sparticuzChromium.headless,
        ignoreHTTPSErrors: true,
      });
    } else {
      log(2, 'Using standard local Puppeteer...');
      browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-extensions',
          '--window-size=1366,900',
        ],
        defaultViewport: { width: 1366, height: 900 },
      });
    }

    const page = await browser.newPage();

    // Realistic user-agent so MEPCO doesn't block us
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
      'AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/120.0.0.0 Safari/537.36'
    );

    // ── STEP 3 ─ Navigate to MEPCO bill portal ───────────
    const URL = 'https://bill.pitc.com.pk/mepcobill';
    log(3, `Navigating to: ${URL}`);

    await page.goto(URL, {
      waitUntil: 'domcontentloaded',
      timeout:   30000,
    });

    log(3, 'Page DOM loaded.');

    // ── STEP 4 ─ Select Search Type & Enter Value ────────
    log(4, `Entering ${displayId} into the form...`);

    // Wait for the form radio buttons to be ready
    await page.waitForSelector('#rbSearchByList_1', { visible: true });

    if (searchType === 'appno') {
      log(4, '  → Switching to "Customer ID" mode (handling ASP.NET postback)');
      // Clicking the Customer ID radio triggers a __doPostBack page reload in ASP.NET
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2' }),
        page.click('#rbSearchByList_1')
      ]);
      // Re-wait for the input box after the page reloads
      await page.waitForSelector('#searchTextBox', { visible: true });
    }

    // Clear and type the search value
    await page.focus('#searchTextBox');
    await page.keyboard.down('Control');
    await page.keyboard.press('A');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await page.type('#searchTextBox', searchValue, { delay: 40 });

    log(4, `Typed search value: ${searchValue}`);

    // ── STEP 5 ─ Click Search ────────────────────────────
    log(5, 'Clicking Search button (#btnSearch)...');

    // Click search and wait for the AJAX response to finish
    await Promise.all([
      page.waitForNetworkIdle({ idleTime: 500, timeout: 15000 })
        .catch(() => {
          // waitForNetworkIdle fallback
          return new Promise(r => setTimeout(r, 1500));
        }),
      page.click('#btnSearch'),
    ]);

    log(5, 'AJAX request completed.');

    // ── STEP 6 ─ Check result ────────────────────────────
    log(6, 'Checking page for bill or error message...');

    const pageText = (await page.evaluate(() => document.body.innerText)).toLowerCase();

    if (
      pageText.includes('does not belong') ||
      pageText.includes('not valid') ||
      pageText.includes('no record') ||
      pageText.includes('please enter valid') ||
      pageText.includes('invalid')
    ) {
      log('ERR', 'MEPCO portal returned: bill not found for this reference.');
      await browser.close();
      return res.status(404).json({
        success: false,
        error: `No bill found for reference number ${referenceNumber}. ` +
               `Make sure it is a MEPCO reference number printed on your electricity bill.`,
      });
    }

    // Quick sanity check — must see SOME bill-related keywords
    const hasBill =
      pageText.includes('amount') ||
      pageText.includes('units') ||
      pageText.includes('consumer') ||
      pageText.includes('due') ||
      pageText.includes('bill') ||
      pageText.includes('payable');

    if (!hasBill) {
      log('ERR', 'Page does not appear to contain bill data.');
    } else {
      log('OK', 'Bill data detected on page!');
    }

    // ── STEP 7 ─ Wait for Loading Screen to Disappear ────
    log(7, 'Ensuring actual bill is fully rendered...');
    
    // Explicitly wait until the "loading" bar is gone and actual bill text appears
    await page.waitForFunction(() => {
      const text = document.body.innerText.toUpperCase();
      return text.includes('BILL CALCULATION') || text.includes('SERVICE RENT');
    }, { timeout: 8000 }).catch(() => log('WARN', 'Could not strict-match bill text. Continuing anyway.'));

    await new Promise(r => setTimeout(r, 300)); // Buffer for final paints
    
    // Scroll to the very top to ensure rendering is triggered for top elements
    await page.evaluate(() => window.scrollTo(0, 0));

    // ── STEP 8 ─ Take Full Page Screenshot ───────────────
    log(8, 'Taking full-page screenshot of the bill...');

    // Expand viewport to minimum practical size to avoid shrinking
    const bodyHandle = await page.$('body');
    const boundingBox = await bodyHandle.boundingBox();
    let newHeight = boundingBox ? boundingBox.height : 2000;
    if (newHeight < 1500) newHeight = 2000;

    await page.setViewport({ width: 1366, height: Math.ceil(newHeight) }); 

    const screenshotBuffer = await page.screenshot({ type: 'png', fullPage: true });

    const base64 = screenshotBuffer.toString('base64');
    log('OK', `Screenshot captured — size: ${(base64.length / 1024).toFixed(1)} KB`);

    // ── STEP 9 ─ Return result ───────────────────────────
    await browser.close();
    log(9, 'Browser closed. Sending bill image to client ✓');

    return res.json({
      success: true,
      image:   base64,
      message: 'Bill fetched successfully!',
    });

  } catch (err) {
    console.error('\n\x1b[31m[FATAL]\x1b[0m Puppeteer crashed:');
    console.error('  Message:', err.message);
    console.error('  Stack:  ', err.stack);

    if (browser) {
      try { await browser.close(); } catch {}
    }

    // Human-readable error messages
    let userMsg = 'Failed to fetch bill. Please try again.';
    if (err.message.includes('timeout') || err.message.includes('Timeout')) {
      userMsg = 'The MEPCO website took too long to respond. Please try again in a moment.';
    } else if (err.message.includes('net::ERR') || err.message.includes('ERR_NAME')) {
      userMsg = 'Cannot connect to the MEPCO website. Check your internet connection.';
    } else if (err.message.includes('waitForSelector') || err.message.includes('waitForFunction')) {
      userMsg = 'Could not find the search field on the MEPCO website. The page may have changed.';
    }

    return res.status(500).json({ success: false, error: userMsg });
  }
});

// ── Health check ─────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', port: PORT }));

// ── Serve frontend ───────────────────────────────────────────
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── START SERVER (Local) or EXPORT (Vercel) ────────────────
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n\x1b[34m╔══════════════════════════════════════════════╗\x1b[0m`);
    console.log(`\x1b[34m║     \x1b[1mMEPCO Bill Checker  —  Server v2\x1b[0m\x1b[34m       ║\x1b[0m`);
    console.log(`\x1b[34m╠══════════════════════════════════════════════╣\x1b[0m`);
    console.log(`\x1b[34m║\x1b[0m   \x1b[32m🟢  Running on  →  http://localhost:${PORT}\x1b[0m   \x1b[34m  ║\x1b[0m`);
    console.log(`\x1b[34m║\x1b[0m  📋  Endpoint   →  POST /get-bill           \x1b[34m║\x1b[0m`);
    console.log(`\x1b[34m║\x1b[0m  🩺  Health     →  GET  /health             \x1b[34m║\x1b[0m`);
    console.log(`\x1b[34m╚══════════════════════════════════════════════╝\x1b[0m\n`);
  });
}

module.exports = app;
