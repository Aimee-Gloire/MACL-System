"use strict";
// S6 / F-14: lightweight, append-only AUDIT LOG of every write request that the
// API performs (timestamp, role, action, target id, result, tx hash). It is a
// deliberate audit-trail feature — it strengthens the proposal's audit-completeness
// claim (RQ3) at the API layer and can be shown live at the defence.
//
// Format: one JSON object per line (JSONL) in api/audit.log (override with
// AUDIT_LOG). JSONL is append-only and trivially queryable, e.g.:
//   cat api/audit.log | jq 'select(.role=="ngo")'
//   grep '"action":"POST /reports"' api/audit.log

const fs = require("node:fs");
const path = require("node:path");

function logPath() {
  return process.env.AUDIT_LOG || path.join(__dirname, "..", "audit.log");
}

// Append one structured entry. Never throws (auditing must not break a request).
function write(entry) {
  const record = { at: new Date().toISOString(), ...entry };
  try {
    fs.appendFileSync(logPath(), JSON.stringify(record) + "\n");
  } catch (_) { /* best-effort: a logging failure must not fail the request */ }
  // Also echo a compact line to the server console for live visibility.
  console.log(`[audit] ${record.action || "?"} role=${record.role || "-"} target=${record.target ?? "-"} result=${record.result ?? "-"} tx=${record.tx || "-"}`);
}

module.exports = { write, logPath };
