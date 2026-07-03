/*
 * MACL Dashboard — configuration
 * ------------------------------------------------------------------
 * Three-tier: the browser talks ONLY to the Tier-2 REST API (api/), which holds
 * the signer keys server-side and brokers every call to the Besu chain. There
 * are NO private keys, RPC URLs, contract addresses or ABIs in the browser any
 * more — those all live server-side now (see api/.env).
 *
 * Loaded as a plain <script> (no modules/bundler), so it just attaches
 * a single global object: window.MACL_CONFIG.
 */
window.MACL_CONFIG = (function () {
  // Base URL of the REST API. Picked automatically so the SAME files work both
  // locally and when hosted — no hand-editing between the two:
  //   1. An explicit override always wins: add `?api=https://host/api` to the URL,
  //      or set `window.MACL_API_BASE` before this script loads.
  //   2. On localhost / 127.0.0.1 (local development) → the local API on port 3001.
  //   3. Anywhere else (hosted) → the same site the dashboard is served from, at
  //      `/api`. On the server, a reverse proxy (e.g. Caddy) serves the dashboard
  //      and forwards `/api` to the Node API — so the browser only ever needs one
  //      address, and there are no cross-origin/mixed-content issues.
  const API_BASE = (function () {
    const override =
      new URLSearchParams(location.search).get("api") || window.MACL_API_BASE;
    if (override) return String(override).replace(/\/+$/, "");
    const host = location.hostname;
    const isLocal = host === "localhost" || host === "127.0.0.1" || host === "";
    if (isLocal) return "http://127.0.0.1:3001/api";
    return location.origin + "/api";
  })();

  return {
  // The one endpoint the whole dashboard talks to.
  API_BASE,

  // Role → display identity (public info only — NO keys in the browser). The
  // acting role comes from LOGIN (BL-13): the API issues a JWT carrying the role,
  // and maps the role to its server-side signing key. These entries are used for
  // display + labelling on-chain addresses, and for the login dropdown.
  ROLES: {
    donor: { label: "Donor",       short: "Donor", address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" },
    ngo:   { label: "NGO",         short: "NGO",   address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" },
    audit: { label: "Audit",       short: "Govt",  address: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" },
  },

  // --- role permissions ---------------------------------------------------
  // These rules are ENFORCED ON-CHAIN (the org registry + role gates in the
  // contracts: only a Donor org creates agreements, only the NGO reports /
  // requests spend, only an agreement's signatories endorse/decline). This map
  // MIRRORS those rules in the UI so a denied action is greyed out before the
  // user pays for a transaction that would revert. Gating is at the ACTION
  // level (not the page level): every role can SEE every page, only the allowed
  // role can OPERATE a given write control. Keep this in sync with the contracts.
  //
  //   agreement.create / addTarget / finalise  -> Donor only
  //   budget.set                               -> Donor only
  //   report.submit                            -> NGO only
  //   spend.request                            -> NGO only (raises a spend request)
  //   record.endorse / record.decline          -> all three (the 2-of-3)
  //   spend.endorse  / spend.decline           -> all three (the 2-of-3 approval)
  PERMISSIONS: {
    donor: ["agreement.create", "agreement.addTarget", "agreement.finalise", "budget.set", "record.endorse", "record.decline", "spend.endorse", "spend.decline"],
    ngo:   ["report.submit", "spend.request", "record.endorse", "record.decline", "spend.endorse", "spend.decline"],
    audit: ["record.endorse", "record.decline", "spend.endorse", "spend.decline"],
  },

  // How denied controls are presented:
  //   "disable" — greyed out + not clickable, layout intact (demo default)
  //   "hide"    — removed from view (show each entity only what it may do)
  PERMISSION_MODE: "disable",

  // --- enum lookups (mirror the Solidity enums, in declaration order) ---

  // ComplianceEvaluationContract.Result { PENDING, PASS, FAIL, FLAG }
  RESULT_LABELS: ["PENDING", "PASS", "FAIL", "FLAG"],

  // AgreementContract.OrgType { NGO, Ministry, Donor }
  ORG_TYPE: ["NGO", "Ministry", "Donor"],

  // Endorsements required to finalise a record (mirrors the contract
  // constant ENDORSEMENT_THRESHOLD; used for the 2-of-3 progress meters).
  ENDORSEMENT_THRESHOLD: 2,

  // Suggested target units (the contract stores unit as a free string;
  // these are just convenience options — note there is NO money/USD,
  // MACL does not handle financial value).
  UNIT_OPTIONS: ["people", "percent", "count", "litres", "households"],

  // The money unit budgets and spend requests are recorded in. MACL never
  // moves or holds money on-chain — this is just a label for the recorded
  // figures (the actual funds move through normal banking, off-chain).
  MONEY_UNIT: "RWF",
  };
})();
