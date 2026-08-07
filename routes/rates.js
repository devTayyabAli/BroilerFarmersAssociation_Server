const express = require("express");
const axios   = require("axios");
const router  = express.Router();

const UPSTREAM  = "https://prod-posts.poultrybaba.com";
const PB_PATH   = "/api/v1/publicRoutes/commodityRate/commodity-history";
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const cache     = new Map(); // key → { data, ts }

/**
 * GET /api/rates/commodity-history?product=BROILER&city=lahore&days=1
 * Proxies to PoultryBaba with correct Origin/Referer headers.
 * Results are cached in-memory for 5 minutes per unique query.
 */
router.get("/commodity-history", async (req, res) => {
  const { product, city, days = 1 } = req.query;

  if (!product || !city) {
    return res.status(400).json({ success: false, error: "product and city are required query params" });
  }

  const upstreamUrl = `${UPSTREAM}${PB_PATH}?product=${product}&city=${city}&days=${days}`;
  const cacheKey    = upstreamUrl;

  // Serve from cache if still fresh
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return res.json(cached.data);
  }

  try {
    const response = await axios.get(upstreamUrl, {
      headers: {
        "Origin":           "https://www.poultrybaba.com",
        "Referer":          "https://www.poultrybaba.com/",
        "User-Agent":       "Mozilla/5.0 (compatible; BFA-Server/1.0)",
        "Accept":           "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
      timeout: 10000,
    });

    cache.set(cacheKey, { data: response.data, ts: Date.now() });
    res.json(response.data);
  } catch (err) {
    const status = err.response?.status || 502;
    const msg    = err.response?.data  || err.message;
    console.error(`[rates proxy] ${status} — ${upstreamUrl} —`, msg);
    res.status(status).json({
      success: false,
      error:   "Failed to fetch rates from upstream",
      detail:  msg,
    });
  }
});

module.exports = router;
