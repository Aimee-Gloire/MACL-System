"use strict";
// Secret-leak guard (S2 / F-02). Greps the TRACKED working tree and the full git
// history for obvious real-secret patterns and exits non-zero if any are found.
//
//   cd api && npm run check:secrets
//
// It NEVER prints the secret itself — only the file (working tree) or commit
// (history) and which pattern matched. Known-public TEST material (the well-known
// Hardhat/Besu keys that deliberately live in *.env.example, and doc placeholders)
// is allow-listed, so a clean repo passes; a real Neon credential or a non-test
// private key fails the check.
//
// Run from anywhere inside the repo; we resolve the repo root via git.

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// --- repo root --------------------------------------------------------------
function git(args, opts = {}) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, ...opts });
}
let repoRoot;
try {
  repoRoot = git(["rev-parse", "--show-toplevel"]).trim();
} catch (_) {
  console.error("check:secrets: not inside a git repository — nothing to scan.");
  process.exit(0);
}

// --- allow-list (known NON-secrets) -----------------------------------------
// The well-known PUBLIC Hardhat/Besu test private keys (no real funds). They are
// deliberately committed in the *.env.example files and documented as test keys
// (see F-11), so they must NOT fail this check.
const PUBLIC_TEST_KEYS = new Set([
  "8f2a55949038a9610f50fb23b5883af3b4ecb3c3bb792cbcefbd1542c692be63", // owner/deployer
  "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", // donor
  "59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", // ngo
  "5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a", // audit
].map((h) => h.toLowerCase()));

// Documentation/example placeholders that are not real JWT secrets.
const PLACEHOLDER_JWT = new Set([
  "change-me-to-a-long-random-string",
  "dev-only-macl-secret-change-me",
]);

// --- patterns ---------------------------------------------------------------
// Each: a name, a global regex, and isReal(captured) → true if this match is a
// genuine secret (not allow-listed). Capture group 1 is the value to classify.
const PATTERNS = [
  {
    name: "neon-db-password (npg_…)",
    re: /npg_[A-Za-z0-9]{8,}/g,
    isReal: () => true, // a real Neon role password is always a secret
  },
  {
    name: "private-key (PRIVATE_KEY=0x…)",
    re: /PRIVATE_KEY=0x([0-9a-fA-F]{64})/g,
    isReal: (hex) => !PUBLIC_TEST_KEYS.has(hex.toLowerCase()),
  },
  {
    name: "jwt-secret (JWT_SECRET=…)",
    re: /JWT_SECRET=([^\s"'`]{16,})/g,
    isReal: (val) => !PLACEHOLDER_JWT.has(val),
  },
];

// Scan one chunk of text; return the set of pattern names that REALLY matched.
function realHits(text) {
  const hits = new Set();
  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    let m;
    while ((m = p.re.exec(text)) !== null) {
      if (p.isReal(m[1] || "")) hits.add(p.name);
    }
  }
  return hits;
}

const findings = []; // { where, pattern }

// --- 1) tracked working tree ------------------------------------------------
const tracked = git(["ls-files"], { cwd: repoRoot }).split("\n").filter(Boolean);
const SKIP_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".pdf", ".ico", ".woff", ".woff2", ".lock"]);
for (const rel of tracked) {
  if (SKIP_EXT.has(path.extname(rel).toLowerCase())) continue;
  if (rel.endsWith("package-lock.json")) continue;        // integrity hashes, no secrets
  if (rel.endsWith("scripts/check-secrets.js")) continue; // this file lists allow-listed values
  const abs = path.join(repoRoot, rel);
  let stat;
  try { stat = fs.statSync(abs); } catch (_) { continue; }
  if (!stat.isFile() || stat.size > 2 * 1024 * 1024) continue;
  let text;
  try { text = fs.readFileSync(abs, "utf8"); } catch (_) { continue; }
  for (const name of realHits(text)) findings.push({ where: `working tree: ${rel}`, pattern: name });
}

// --- 2) full git history ----------------------------------------------------
// One pass over every added line in history; track the current commit header and
// classify added content. We never print the line, only the commit + pattern.
let history = "";
try {
  history = git(["log", "--all", "-p", "--no-color", "--unified=0"], { cwd: repoRoot });
} catch (_) { /* no history yet */ }
let commit = "(unknown)";
const seen = new Set();
for (const line of history.split("\n")) {
  const ch = line.match(/^commit ([0-9a-f]{40})/);
  if (ch) { commit = ch[1].slice(0, 10); continue; }
  if (line[0] !== "+" || line.startsWith("+++")) continue; // added lines only
  for (const name of realHits(line.slice(1))) {
    const key = `${commit}|${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push({ where: `history commit ${commit}`, pattern: name });
  }
}

// --- report -----------------------------------------------------------------
if (findings.length === 0) {
  console.log("check:secrets: OK — no real secrets found in tracked files or git history.");
  process.exit(0);
}
console.error(`check:secrets: FAILED — ${findings.length} potential secret(s) found:`);
for (const f of findings) console.error(`  - ${f.pattern}  @  ${f.where}`);
console.error("\nThe matched VALUES are not printed. Remove the secret from the file, rotate it,");
console.error("and purge it from history (git filter-repo / BFG) before sharing the repo.");
process.exit(1);
