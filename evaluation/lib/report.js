"use strict";
// Render the metric rows as a Markdown table (for the report) and CSV (for data).
// Each row: { metric, macl, baseline, better, notes }

const HEADERS = ["Metric", "MACL (Besu)", "PostgreSQL baseline", "Better", "Notes"];

function render(rows) {
  const md = [
    `| ${HEADERS.join(" | ")} |`,
    `| ${HEADERS.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${cells(r).map(mdCell).join(" | ")} |`),
  ].join("\n");

  const csv = [
    HEADERS.join(","),
    ...rows.map((r) => cells(r).map(csvCell).join(",")),
  ].join("\n");

  return { md, csv };
}

function cells(r) {
  return [r.metric, r.macl, r.baseline, r.better, r.notes || ""];
}
function mdCell(v) {
  return String(v).replace(/\|/g, "\\|");
}
function csvCell(v) {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

module.exports = { render };
