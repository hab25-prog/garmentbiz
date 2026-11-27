-- Add durable idempotency metadata to expense audit entries.
-- Existing audit rows remain unchanged and receive NULL for both new fields.
ALTER TABLE "ExpenseAuditLog"
  ADD COLUMN "idempotencyKey" VARCHAR(128),
  ADD COLUMN "requestHash" VARCHAR(64);

CREATE UNIQUE INDEX "ExpenseAuditLog_businessId_idempotencyKey_key"
  ON "ExpenseAuditLog"("businessId", "idempotencyKey");

ALTER TABLE "ExpenseAuditLog"
  ADD CONSTRAINT "ExpenseAuditLog_idempotency_fields_pair_check"
  CHECK (("idempotencyKey" IS NULL) = ("requestHash" IS NULL));
