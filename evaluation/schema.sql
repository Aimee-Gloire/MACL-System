-- Centralised baseline schema (the RQ3 control group).
-- Mirrors the data MACL holds on-chain (agreements, targets, compliance records)
-- in a single PostgreSQL instance. There is intentionally NO history/audit table
-- and NO row fingerprints — the point of the control group is to measure what a
-- plain centralised store gives you: in-place UPDATEs, no independent reference,
-- no consensus. The metric scripts exploit exactly these gaps.

DROP TABLE IF EXISTS compliance_records;
DROP TABLE IF EXISTS targets;
DROP TABLE IF EXISTS agreements;

CREATE TABLE agreements (
  id              BIGINT  PRIMARY KEY,
  creator         TEXT    NOT NULL,
  start_date      BIGINT  NOT NULL,
  end_date        BIGINT  NOT NULL,
  finalised       BOOLEAN NOT NULL DEFAULT FALSE,
  budget          NUMERIC NOT NULL DEFAULT 0,
  committed_spend NUMERIC NOT NULL DEFAULT 0
);

CREATE TABLE targets (
  agreement_id BIGINT  NOT NULL REFERENCES agreements(id),
  target_index INT     NOT NULL,
  indicator    TEXT    NOT NULL,
  threshold    NUMERIC NOT NULL,
  unit         TEXT    NOT NULL,
  deadline     BIGINT  NOT NULL,
  PRIMARY KEY (agreement_id, target_index)
);

CREATE TABLE compliance_records (
  id             BIGINT   PRIMARY KEY,
  agreement_id   BIGINT   NOT NULL REFERENCES agreements(id),
  target_index   INT      NOT NULL,
  reported_value NUMERIC  NOT NULL,
  result         SMALLINT NOT NULL,         -- 0 PENDING, 1 PASS, 2 FAIL, 3 FLAG
  evaluated_at   BIGINT   NOT NULL,
  submitter      TEXT     NOT NULL,
  finalised      BOOLEAN  NOT NULL DEFAULT FALSE,
  document_hash  TEXT
);
