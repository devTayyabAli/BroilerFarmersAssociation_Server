const express = require("express");
const router  = express.Router();
const path    = require("path");
const fs      = require("fs").promises;
const axios   = require("axios");
const cheerio = require("cheerio");

// Load data once at startup
let ALL_RATES = [];
let dataLoaded = false;

// Rate limiting for sync endpoint
let lastSyncTime = 0;
const SYNC_COOLDOWN_MS = 60000; // 60 seconds

async function loadRatesData() {
  if (dataLoaded) return;
  try {
    const dataPath = path.join(__dirname, "../../agbro-rates/data/agbro-rates-flat.json");
    const raw = await fs.readFile(dataPath, "utf-8");
    ALL_RATES = JSON.parse(raw);
    dataLoaded = true;
    console.log(`✅ Loaded ${ALL_RATES.length} historical broiler rate records`);
  } catch (err) {
    console.error("❌ Failed to load broiler rates data:", err.message);
    ALL_RATES = [];
  }
}

// Force reload data from disk (used after sync)
async function reloadRatesData() {
  try {
    const dataPath = path.join(__dirname, "../../agbro-rates/data/agbro-rates-flat.json");
    const raw = await fs.readFile(dataPath, "utf-8");
    ALL_RATES = JSON.parse(raw);
    console.log(`🔄 Reloaded ${ALL_RATES.length} broiler rate records`);
  } catch (err) {
    console.error("❌ Failed to reload broiler rates data:", err.message);
  }
}

// Parse numeric rate value
function parseRate(val) {
  if (!val || val === "—" || val === "") return null;
  const n = parseFloat(val.toString().replace(/,/g, ""));
  return isNaN(n) ? null : n;
}

/**
 * GET /api/broiler-rates
 *
 * Supports two modes depending on query params:
 *
 * ── Cursor mode (infinite scroll, "All Years") ──────────────────────────────
 *   ?cursor=<opaque>&limit=30   → returns next batch of `limit` unique dates
 *   Cursor encodes: "<dateIndex>" (integer position in sorted unique-date list)
 *   Response: { success, data, pagination: { limit, hasNextPage, nextCursor } }
 *
 * ── Single-year mode (full year, no cursor) ──────────────────────────────────
 *   ?year=2026                  → returns entire year's data at once (no cursor)
 *   Response: { success, data, pagination: { limit, hasNextPage: false, nextCursor: null } }
 *
 * Common params (both modes):
 *   - year:   "all" (default) or specific year string
 *   - city:   comma-separated city names
 *   - search: substring match against Date field
 *   - limit:  batch size in unique dates (cursor mode only, default 30, max 120)
 */
router.get("/", async (req, res) => {
  await loadRatesData();

  const { year = "all", city = "", search = "", cursor, limit = "30" } = req.query;

  // ── Filters ──────────────────────────────────────────────────────────────
  const citySet     = city ? new Set(city.split(",").map(c => c.trim()).filter(Boolean)) : null;
  const searchLower = search.trim().toLowerCase();

  const filtered = ALL_RATES.filter(row => {
    if (year !== "all" && row.Year !== year) return false;
    if (citySet && !citySet.has(row.City))   return false;
    if (searchLower && !row.Date.toLowerCase().includes(searchLower)) return false;
    return true;
  });

  // ── Sort: newest date first, stable ──────────────────────────────────────
  const MONTH_ORDER = {
    Jan:1, Feb:2, Mar:3, Apr:4, May:5, Jun:6,
    Jul:7, Aug:8, Sep:9, Oct:10, Nov:11, Dec:12,
    // Full names used in AGBRO data for June & July
    June:6, July:7,
    January:1, February:2, March:3, April:4,
    August:8, September:9, October:10, November:11, December:12,
  };
  const dateScore = (dateStr) => {
    const [d, m, y] = (dateStr || "").split("-");
    return (parseInt(y) || 0) * 10000 + (MONTH_ORDER[m] || 0) * 100 + (parseInt(d) || 0);
  };

  filtered.sort((a, b) => dateScore(b.Date) - dateScore(a.Date));

  // ── For a specific year: return everything, no cursor ────────────────────
  if (year !== "all") {
    return res.json({
      success: true,
      data: filtered,
      pagination: {
        limit: filtered.length,
        hasNextPage: false,
        nextCursor: null,
      },
    });
  }

  // ── Cursor-based pagination for "all years" ───────────────────────────────
  // Work in terms of unique dates so we never split a day across two pages.
  const batchSize = Math.min(120, Math.max(1, parseInt(limit) || 30));

  // Build ordered unique-date list (already sorted by the sort above)
  const seenDates  = new Set();
  const uniqueDates = [];
  for (const row of filtered) {
    if (!seenDates.has(row.Date)) {
      seenDates.add(row.Date);
      uniqueDates.push(row.Date);
    }
  }

  // Decode cursor → start index in uniqueDates
  let startIdx = 0;
  if (cursor) {
    const decoded = parseInt(Buffer.from(cursor, "base64").toString("utf8"), 10);
    startIdx = isNaN(decoded) ? 0 : decoded;
  }

  const pageDates   = new Set(uniqueDates.slice(startIdx, startIdx + batchSize));
  const endIdx      = startIdx + batchSize;
  const hasNextPage = endIdx < uniqueDates.length;
  const nextCursor  = hasNextPage
    ? Buffer.from(String(endIdx)).toString("base64")
    : null;

  const data = filtered.filter(row => pageDates.has(row.Date));

  res.json({
    success: true,
    data,
    pagination: {
      limit: batchSize,
      hasNextPage,
      nextCursor,
    },
  });
});

/**
 * GET /api/broiler-rates/summary
 * Returns latest rate + delta vs previous date for each city
 */
router.get("/summary", async (req, res) => {
  await loadRatesData();

  const cities = [...new Set(ALL_RATES.map(r => r.City))];
  const summary = cities.map(city => {
    const cityRows = ALL_RATES.filter(r => r.City === city);
    if (!cityRows.length) return null;

    // Get last 2 rows
    const latest = cityRows[cityRows.length - 1];
    const prev   = cityRows.length > 1 ? cityRows[cityRows.length - 2] : null;

    const latestRate = parseRate(latest.FarmRate);
    const prevRate   = prev ? parseRate(prev.FarmRate) : null;

    let delta = null;
    let status = "stable";
    if (latestRate !== null && prevRate !== null) {
      delta = latestRate - prevRate;
      status = delta > 0 ? "up" : delta < 0 ? "down" : "stable";
    }

    return {
      city,
      latestRate: latestRate !== null ? latestRate : "—",
      latestDate: latest.Date,
      delta: delta !== null ? delta : "—",
      status,
    };
  }).filter(Boolean);

  res.json({ success: true, data: summary });
});

/**
 * GET /api/broiler-rates/years
 * Returns list of all years in the dataset
 */
router.get("/years", async (req, res) => {
  await loadRatesData();
  const years = [...new Set(ALL_RATES.map(r => r.Year))].sort();
  res.json({ success: true, data: years });
});

/**
 * GET /api/broiler-rates/cities
 * Returns list of all cities in the dataset
 */
router.get("/cities", async (req, res) => {
  await loadRatesData();
  const cities = [...new Set(ALL_RATES.map(r => r.City))];
  res.json({ success: true, data: cities });
});

// ── SCRAPER HELPER FUNCTIONS (reused from scrape.js) ────────────────────────

const CITY_FIELD_COUNTS = {
  Rawalpindi: 4, // DOC, Farm Rate, Open, Close
  Lahore: 4,
  Faisalabad: 4,
  Karachi: 2, // DOC, Farm Rate only
  Multan: 2,
};

function findSubHeaderRowIndex($, table) {
  const rows = $(table).find("tr");
  let found = -1;
  rows.each((i, tr) => {
    if (found !== -1) return;
    const firstCellText = $(tr).find("th,td").eq(0).text().trim();
    if (firstCellText === "Date") found = i;
  });
  return found;
}

function buildColumnPaths($, table, subHeaderRowIdx) {
  const rows = $(table).find("tr");
  const groupRow = rows.eq(subHeaderRowIdx - 1);
  const subRow = rows.eq(subHeaderRowIdx);

  const cityNames = [];
  let eggLabel = "PunjabEggRate";
  groupRow.find("th,td").each((i, el) => {
    const text = $(el).text().trim();
    if (!text) return;
    if (/egg/i.test(text)) {
      eggLabel = text.replace(/\s+/g, "");
    } else {
      cityNames.push(text.replace(/\s+/g, ""));
    }
  });

  const subHeaders = [];
  subRow.find("th,td").each((i, el) => {
    if ($(el).attr("rowspan")) return;
    subHeaders.push($(el).text().trim());
  });

  const colPaths = [subHeaders[0] || "Date", subHeaders[1] || "Day"];
  let cursor = 2;
  for (const city of cityNames) {
    const count = CITY_FIELD_COUNTS[city] ?? 4;
    for (let i = 0; i < count; i++) {
      const label = (subHeaders[cursor] || `field${i}`).replace(/\s+/g, "");
      colPaths.push(`${city}_${label}`);
      cursor++;
    }
  }
  while (cursor < subHeaders.length) {
    const label = (subHeaders[cursor] || "value").replace(/\s+/g, "");
    colPaths.push(`${eggLabel}_${label}`);
    cursor++;
  }

  return { colPaths };
}

function parseMonthTable($, table, year) {
  const subHeaderRowIdx = findSubHeaderRowIndex($, table);
  if (subHeaderRowIdx === -1) return [];

  const { colPaths } = buildColumnPaths($, table, subHeaderRowIdx);
  const rows = $(table).find("tr");
  const records = [];

  for (let i = subHeaderRowIdx + 1; i < rows.length; i++) {
    const cells = rows.eq(i).find("td,th");
    if (cells.length < 2) continue;

    const values = [];
    cells.each((idx, el) => values.push($(el).text().trim()));

    const dateVal = values[0] || "";
    if (!dateVal || !/\d/.test(dateVal)) continue;

    const rec = { Year: String(year) };
    colPaths.forEach((p, idx) => {
      rec[p] = values[idx] !== undefined ? values[idx] : "";
    });
    records.push(rec);
  }
  return records;
}

function toFlatRows(wideRecords) {
  const cities = Object.keys(CITY_FIELD_COUNTS);
  const flat = [];
  for (const rec of wideRecords) {
    for (const city of cities) {
      const doc = rec[`${city}_DOC`];
      const farm = rec[`${city}_FarmRate`];
      if (doc === undefined && farm === undefined) continue;
      flat.push({
        Year: rec.Year,
        Date: rec.Date,
        Day: rec.Day,
        City: city,
        DOC: doc || "",
        FarmRate: farm || "",
        Open: rec[`${city}_Open`] || "",
        Close: rec[`${city}_Close`] || "",
        PunjabEggRatePer30Dozen: rec["PunjabEggRate_Per30Dozen"] || "",
      });
    }
  }
  return flat;
}

async function scrapeCurrentYear() {
  const currentYear = new Date().getFullYear();
  const url = "https://www.agbro.com/"; // Homepage always shows current year

  console.log(`🔍 Scraping current year (${currentYear}) from ${url}`);
  
  const { data: html } = await axios.get(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; BFA-Sync/1.0)" },
    timeout: 20000,
  });

  const $ = cheerio.load(html);
  const tables = $("table").filter((i, t) => findSubHeaderRowIndex($, t) !== -1);

  let allRecords = [];
  tables.each((i, t) => {
    const recs = parseMonthTable($, t, currentYear);
    allRecords = allRecords.concat(recs);
  });

  console.log(`  ✅ Parsed ${allRecords.length} wide records from ${tables.length} tables`);
  return toFlatRows(allRecords);
}

/**
 * POST /api/broiler-rates/sync
 * Incrementally sync latest rates from agbro.com
 */
router.post("/sync", async (req, res) => {
  try {
    // Rate limiting check
    const now = Date.now();
    const timeSinceLastSync = now - lastSyncTime;
    if (timeSinceLastSync < SYNC_COOLDOWN_MS) {
      const remainingSeconds = Math.ceil((SYNC_COOLDOWN_MS - timeSinceLastSync) / 1000);
      return res.status(429).json({
        success: false,
        error: `Please wait ${remainingSeconds} seconds before syncing again`,
        remainingSeconds,
      });
    }

    await loadRatesData();

    // Scrape current year data
    const freshRows = await scrapeCurrentYear();
    
    if (!freshRows || freshRows.length === 0) {
      return res.json({
        success: true,
        added: 0,
        skipped: 0,
        latestDate: null,
        message: "No new data found on AGBRO.com"
      });
    }

    // Build existing data map: "Date|City" -> true
    const existingMap = new Map();
    ALL_RATES.forEach(row => {
      const key = `${row.Date}|${row.City}`;
      existingMap.set(key, true);
    });

    // Filter new rows
    const newRows = freshRows.filter(row => {
      const key = `${row.Date}|${row.City}`;
      return !existingMap.has(key);
    });

    let added = 0;
    let skipped = freshRows.length - newRows.length;
    let latestDate = null;

    if (newRows.length > 0) {
      // Append new rows to in-memory array
      ALL_RATES.push(...newRows);

      // Write back to disk
      const dataPath = path.join(__dirname, "../../agbro-rates/data/agbro-rates-flat.json");
      await fs.writeFile(dataPath, JSON.stringify(ALL_RATES, null, 2), "utf-8");

      added = newRows.length;

      // Find the most recent date among newly added rows
      const monthOrder = {
        Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12,
        June:6,July:7,
      };
      const parseSyncDate = (d) => {
        const [day, mon, yr] = (d || "").split("-");
        return (parseInt(yr)||0)*10000 + (monthOrder[mon]||0)*100 + (parseInt(day)||0);
      };
      latestDate = newRows
        .map(r => r.Date)
        .filter(Boolean)
        .sort((a, b) => parseSyncDate(b) - parseSyncDate(a))[0] || null;

      console.log(`✅ Sync complete: +${added} new rows, ${skipped} skipped`);
    } else {
      console.log(`✅ Sync complete: No new data (${skipped} existing rows found)`);
    }

    // Update last sync time
    lastSyncTime = now;

    res.json({
      success: true,
      added,
      skipped,
      latestDate,
      message: added > 0 
        ? `Added ${added} new rate${added > 1 ? 's' : ''}` 
        : "Already up to date"
    });

  } catch (err) {
    console.error("❌ Sync failed:", err.message);
    res.status(500).json({
      success: false,
      error: err.message || "Failed to sync rates",
    });
  }
});

module.exports = router;
