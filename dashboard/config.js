/*
 * MACL Dashboard — configuration
 * ------------------------------------------------------------------
 * The ONE place that holds everything environment-specific. When you
 * later swap the local Hardhat node for the Besu QBFT network, you
 * only edit this file — the rest of the dashboard stays the same.
 *
 * Loaded as a plain <script> (no modules/bundler), so it just attaches
 * a single global object: window.MACL_CONFIG.
 */
window.MACL_CONFIG = (function () {
  // --- network toggle -----------------------------------------------------
  // Flip this ONE value to point the whole dashboard at a different chain:
  //   "local" — the single Hardhat node (dev/demo default)
  //   "besu"  — the real 3-node Hyperledger Besu QBFT network (see RUN-BESU.md)
  // Everything else (ABIs, roles, permissions) is identical across networks.
  const NETWORK = "besu"; // "local" | "besu"

  // Per-network RPC endpoint + deployed contract addresses. Both sets are the
  // DETERMINISTIC addresses you get from a fresh deploy in declaration order
  // (Agreement → Compliance → Verification). They differ between networks only
  // because the deployer account differs (Hardhat acct #0 vs the Besu genesis
  // deployer 0xfe3b…). If you deploy onto a chain that is NOT fresh, paste the
  // addresses printed by the deploy script over the matching set below.
  const NETWORKS = {
    local: {
      RPC_URL: "http://127.0.0.1:8545",
      ADDRESSES: {
        Agreement:    "0x5FbDB2315678afecb367f032d93F642f64180aa3",
        Compliance:   "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
        Verification: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
      },
    },
    besu: {
      // Node-1's RPC. The browser only needs ONE node to read/write; the other
      // two are listed in NODES below for the Part 4 cross-node integrity panel.
      RPC_URL: "http://127.0.0.1:8545",
      ADDRESSES: {
        Agreement:    "0x42699A7612A82f1d9C36148af9C77354759b210b",
        Compliance:   "0xa50a51c09a5c451C52BB714527E1974b686D8e77",
        Verification: "0x9a3DBCa554e9f6b9257aAa24010DA8377C57c17e",
      },
    },
  };

  // The three Besu validator RPC endpoints (host ports from blockchain/docker-compose.yml).
  // Used later by the Part 4 panel that compares each node's view of the ledger.
  const NODES = [
    { label: "Node-1 (NGO)",      url: "http://127.0.0.1:8545" },
    { label: "Node-2 (Ministry)", url: "http://127.0.0.1:8546" },
    { label: "Node-3 (Donor)",    url: "http://127.0.0.1:8547" },
  ];

  const active = NETWORKS[NETWORK];

  return {
  // Which network is live, and the resolved endpoint/addresses for it.
  NETWORK,
  NODES,

  // JSON-RPC endpoint of the chain the browser talks to directly.
  RPC_URL: active.RPC_URL,

  // The deployed contract addresses for the active network.
  ADDRESSES: active.ADDRESSES,

  // Where to fetch each contract's ABI. These paths are served by a
  // static server running from the REPO ROOT (macl/), so the browser
  // can reach the compiler artifacts that live above the dashboard.
  ABI_PATHS: {
    Agreement:    "/contracts/artifacts/contracts/AgreementContract.sol/AgreementContract.json",
    Compliance:   "/contracts/artifacts/contracts/ComplianceEvaluationContract.sol/ComplianceEvaluationContract.json",
    Verification: "/contracts/artifacts/contracts/VerificationWorkflowContract.sol/VerificationWorkflowContract.json",
  },

  // Role → Hardhat dev account. Each role view signs as its own
  // address, which is what makes the 2-of-3 endorsement meaningful
  // (two DISTINCT accounts must endorse a record).
  //
  // SECURITY NOTE: these are the WELL-KNOWN, PUBLIC Hardhat test keys.
  // They exist only on the local dev chain and control no real funds.
  // Never reuse this pattern with a real private key.
  ROLES: {
    donor: {
      label: "Donor-Admin",
      short: "Donor",
      address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      key: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    },
    ngo: {
      label: "NGO",
      short: "NGO",
      address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      key: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
    },
    audit: {
      label: "Audit",
      short: "Govt",
      address: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
      key: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
    },
  },

  // Default role the dashboard opens with (overridden by localStorage
  // once the user picks a role — see chain.js getRole/setRole).
  DEFAULT_ROLE: "donor",

  // --- role permissions (UI gating only) ---------------------------------
  // The contracts only gate by `creator`; this map enforces the real-world
  // division of duties in the DASHBOARD so the demo shows each role acting
  // as its own entity. Gating is at the ACTION level (not the page level):
  // every role can SEE every page, only the allowed role can OPERATE a
  // given write control. This is the ONE place to edit if the rules change.
  //
  //   agreement.create / addTarget / finalise  -> Donor-Admin only
  //   budget.set                               -> Donor-Admin only
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
