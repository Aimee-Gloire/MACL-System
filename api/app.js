"use strict";
// Builds the Express app. Separated from server.js so tests can import the app
// without opening a listening socket. Pass a custom `chain` for testing; by
// default it wires a real one from env config.

const crypto = require("node:crypto");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { config } = require("./lib/config");
const { makeChain } = require("./lib/chain");
const { makeRouter } = require("./routes");
const { makeDocsRouter } = require("./routes.documents");
const { makeAuthRouter } = require("./routes.auth");
const { required, authConfig } = require("./lib/auth");
const { makePool } = require("./lib/db");
const { makeDocStore, makeUnconfiguredStore } = require("./lib/documents");

function createApp(opts = {}) {
  // Fail-closed (F-01): validate the JWT secret up front so the app refuses to
  // boot on a missing/too-short secret rather than silently signing weak tokens.
  authConfig();

  const cfg = opts.config || config();
  const chain = opts.chain || makeChain(cfg);
  // Document store (BL-12): real Postgres store when DATABASE_URL is set,
  // otherwise a stub whose endpoints 503 (the rest of the API still works).
  const docs = opts.docs || (() => {
    const pool = makePool();
    return pool ? makeDocStore(pool) : makeUnconfiguredStore();
  })();

  const app = express();
  app.set("trust proxy", 1); // deployed behind a reverse proxy (Caddy); required for per-IP rate limiting

  // S5 / F-13: security headers. The strict CSP + nosniff matter most for the
  // document-download response (an evidence file must never render/run in our
  // origin); they're harmless on the JSON API. crossOriginResourcePolicy is set to
  // cross-origin because the dashboard is a different origin (CORS is already
  // pinned in F-10), so it must be allowed to read the API's responses.
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }));
  // Expose Content-Disposition so the dashboard's cross-origin fetch() can read
  // the download filename (F-07 saves the file via a Blob).
  app.use(cors({ origin: cfg.corsOrigin, exposedHeaders: ["Content-Disposition"] }));

  // S6 / F-09: a generous global rate limit as a safety net against abuse/loops.
  // Tunable via RATE_LIMIT_MAX; the public health poll is exempt so the dashboard's
  // connection light never trips it. (Login has its own stricter limiter.)
  app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    max: Number(process.env.RATE_LIMIT_MAX || 2000),
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.method === "GET" && req.path === "/api/health",
    handler: (_req, res) => res.status(429).json({ error: "too many requests — please slow down" }),
  }));

  // Document routes parse their OWN raw (binary) body, so they must be mounted
  // BEFORE the JSON parser (else a .json file upload would be JSON-parsed). They
  // require a valid session (BL-13).
  app.use("/api/documents", required, makeDocsRouter(docs));

  // JSON body parsing for everything else.
  app.use(express.json());

  // Public: login (and /me verifies its own token).
  app.use("/api/auth", makeAuthRouter());

  // /api/health stays public (the connection light needs it before login);
  // every other /api route requires a valid session token.
  app.use("/api", (req, res, next) => {
    if (req.method === "GET" && req.path === "/health") return next();
    return required(req, res, next);
  }, makeRouter(chain));

  // 404 for anything else.
  app.use((req, res) => res.status(404).json({ error: `not found: ${req.method} ${req.path}` }));

  // Central error handler. S6 / F-14: clean 4xx messages (validation / 401 / 403)
  // are passed through as-is, but 5xx never leak internal/revert text to the client
  // — the caller gets a generic message + a short error id, and the full detail is
  // logged server-side under that id so it can still be diagnosed.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || 500;
    if (status >= 500) {
      const errorId = crypto.randomUUID().slice(0, 8);
      console.error(`[error ${errorId}] ${req.method} ${req.originalUrl} -> ${status}: ${err && (err.stack || err.message) || err}`);
      return res.status(status).json({ error: "internal server error", errorId });
    }
    res.status(status).json({ error: err.message || String(err) });
  });

  return { app, cfg, chain, docs };
}

module.exports = { createApp };
