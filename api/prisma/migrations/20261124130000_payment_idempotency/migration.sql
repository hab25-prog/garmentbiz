-- Add optional request idempotency metadata for manual payments.
-- Existing payment rows are preserved; nullable fields remain NULL for historical records.
ALTER TABLE "Payment"
  ADD COLUMN "idempotencyKey" VARCHAR(128),
  ADD COLUMN "requestHash" VARCHAR(64);

CREATE UNIQUE INDEX "Payment_businessId_invoiceId_idempotencyKey_key"
  ON "Payment"("businessId", "invoiceId", "idempotencyKey");

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_idempotency_fields_pair_check"
  CHECK (("idempotencyKey" IS NULL) = ("requestHash" IS NULL));
