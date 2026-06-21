"use strict";
// Builds the Express app. Separated from server.js so tests can import the app
// without opening a listening socket. Pass a custom `chain` for testing; by
// default it wires a real one from env config.

const express = require("express");
const cors = require("cors");
const { config } = require("./lib/config");
const { makeChain } = require("./lib/chain");
const { makeRouter } = require("./routes");
const { makeDocsRouter } = require("./routes.documents");
const { makeAuthRouter } = require("./routes.auth");
const { required } = require("./lib/auth");
const { makePool } = require("./lib/db");
const { makeDocStore, makeUnconfiguredStore } = require("./lib/documents");

function createApp(opts = {}) {
  const cfg = opts.config || config();
  const chain = opts.chain || makeChain(cfg);
  // Document store (BL-12): real Postgres store when DATABASE_URL is set,
  // otherwise a stub whose endpoints 503 (the rest of the API still works).
  const docs = opts.docs || (() => {
    const pool = makePool();
    return pool ? makeDocStore(pool) : makeUnconfiguredStore();
  })();

  const app = express();
  app.use(cors({ origin: cfg.corsOrigin }));

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

  // Central error handler — maps ApiError.status, defaults to 500.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || String(err) });
  });

  return { app, cfg, chain, docs };
}

module.exports = { createApp };
