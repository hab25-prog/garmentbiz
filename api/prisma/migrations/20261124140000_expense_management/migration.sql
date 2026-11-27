-- Add expense payment metadata, void tracking, and immutable audit history.
-- Existing paymentMethod values remain NULL; no historical method is inferred.
CREATE TYPE "ExpenseAuditAction" AS ENUM ('CREATED', 'UPDATED', 'VOIDED');

ALTER TABLE "Expense"
  ADD COLUMN "paymentMethod" "PaymentMethod",
  ADD COLUMN "voidReason" TEXT,
  ADD COLUMN "voidedAt" TIMESTAMP(3),
  ADD COLUMN "voidedByUserId" TEXT;

-- Expense DateTime columns are stored as UTC timestamps without a timezone.
-- Interpret the selected existing period month (or expense date) as UTC, derive
-- the Addis Ababa accounting month, then store local midnight as its UTC instant.
UPDATE "Expense"
SET "periodMonth" = (
  date_trunc(
    'month',
    COALESCE("periodMonth", "expenseDate") AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Addis_Ababa'
  ) AT TIME ZONE 'Africa/Addis_Ababa' AT TIME ZONE 'UTC'
);

ALTER TABLE "Expense"
  ALTER COLUMN "periodMonth" SET NOT NULL;

CREATE TABLE "ExpenseAuditLog" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "expenseId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "actorMembershipId" TEXT NOT NULL,
  "actorNameSnapshot" TEXT NOT NULL,
  "action" "ExpenseAuditAction" NOT NULL,
  "reason" TEXT,
  "previousValues" JSONB,
  "newValues" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExpenseAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ExpenseAuditLog_businessId_expenseId_createdAt_idx"
  ON "ExpenseAuditLog"("businessId", "expenseId", "createdAt");
CREATE INDEX "ExpenseAuditLog_actorUserId_createdAt_idx"
  ON "ExpenseAuditLog"("actorUserId", "createdAt");
CREATE INDEX "ExpenseAuditLog_actorMembershipId_createdAt_idx"
  ON "ExpenseAuditLog"("actorMembershipId", "createdAt");
CREATE UNIQUE INDEX "Membership_businessId_id_userId_key"
  ON "Membership"("businessId", "id", "userId");
CREATE INDEX "Expense_businessId_periodMonth_idx"
  ON "Expense"("businessId", "periodMonth");
CREATE INDEX "Expense_voidedByUserId_idx"
  ON "Expense"("voidedByUserId");
CREATE UNIQUE INDEX "Expense_businessId_id_key"
  ON "Expense"("businessId", "id");

ALTER TABLE "Expense"
  ADD CONSTRAINT "Expense_voidedByUserId_fkey"
  FOREIGN KEY ("voidedByUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ExpenseAuditLog"
  ADD CONSTRAINT "ExpenseAuditLog_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExpenseAuditLog"
  ADD CONSTRAINT "ExpenseAuditLog_businessId_expenseId_fkey"
  FOREIGN KEY ("businessId", "expenseId") REFERENCES "Expense"("businessId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExpenseAuditLog"
  ADD CONSTRAINT "ExpenseAuditLog_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExpenseAuditLog"
  ADD CONSTRAINT "ExpenseAuditLog_businessId_actorMembershipId_actorUserId_fkey"
  FOREIGN KEY ("businessId", "actorMembershipId", "actorUserId")
  REFERENCES "Membership"("businessId", "id", "userId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
