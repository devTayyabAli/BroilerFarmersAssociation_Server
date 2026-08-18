require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const rateLimit = require("express-rate-limit");

const ratesRouter        = require("./routes/rates");
const broilerRatesRouter = require("./routes/broiler-rates");
const membersRouter      = require("./routes/members");
const contactRouter      = require("./routes/contact");

const app  = express();
const PORT = process.env.PORT || 5000;

// ── CORS ──────────────────────────────────────────────────────────
const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map(o => o.trim().replace(/\/$/, "")) // strip trailing slashes
  .filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // allow requests with no origin (server-to-server, curl, same-origin)
    if (!origin) return cb(null, true);
    const normalised = origin.replace(/\/$/, "");
    if (allowedOrigins.length === 0 || allowedOrigins.includes(normalised)) return cb(null, true);
    cb(new Error(`CORS: ${origin} not allowed`));
  },
  credentials: true,
}));

app.use(express.json());

// ── Trust proxy (required when behind Nginx / Docker reverse proxy) ─
// Without this, express-rate-limit throws ERR_ERL_UNEXPECTED_X_FORWARDED_FOR
// because it sees the X-Forwarded-For header but Express doesn't trust it.
// '1' means trust the first hop (the Nginx/Traefik/Caddy proxy in front of us).
app.set("trust proxy", 1);

// ── Rate limiting ─────────────────────────────────────────────────
// Rates proxy: high limit — fires 75+ parallel city requests per page load,
// all cached for 5 min on the server so real upstream hits are minimal.
const ratesLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,  // 1 minute
  max: 500,                  // 500 req/min per IP — covers all city fetches
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: "Too many requests. Please try again later." },
});

// Forms: strict limit to prevent spam
const formsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,                   // 20 form submissions per 15 min per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: "Too many submissions. Please try again later." },
});

// ── MongoDB ───────────────────────────────────────────────────────
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => {
    console.error("❌ MongoDB connection error:", err.message);
    process.exit(1);
  });

// ── Routes ────────────────────────────────────────────────────────
app.use("/api/rates",         ratesLimiter, ratesRouter);
app.use("/api/broiler-rates", ratesLimiter, broilerRatesRouter);
app.use("/api/members",       formsLimiter, membersRouter);
app.use("/api/contact",       formsLimiter, contactRouter);

// ── Health check ──────────────────────────────────────────────────
app.get("/api/health", (_, res) => res.json({ status: "ok", time: new Date().toISOString() }));

// ── 404 ───────────────────────────────────────────────────────────
app.use((_, res) => res.status(404).json({ success: false, error: "Route not found" }));

// ── Global error handler ──────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).json({ success: false, error: err.message || "Internal server error" });
});

app.listen(PORT, () => console.log(`🚀 BFA server running on port ${PORT}`));
