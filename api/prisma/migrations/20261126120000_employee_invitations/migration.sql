-- CreateEnum
CREATE TYPE "EmployeeInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "email" VARCHAR(320),
ADD COLUMN     "userId" TEXT;

-- CreateTable
CREATE TABLE "EmployeeInvitation" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "inviterMembershipId" TEXT NOT NULL,
    "inviterUserId" TEXT NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "status" "EmployeeInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "acceptedByMembershipId" TEXT,
    "expiredAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedByMembershipId" TEXT,
    "smtpAcceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeInvitation_tokenHash_key" ON "EmployeeInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "EmployeeInvitation_businessId_status_createdAt_idx" ON "EmployeeInvitation"("businessId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "EmployeeInvitation_businessId_email_status_idx" ON "EmployeeInvitation"("businessId", "email", "status");

-- CreateIndex
CREATE INDEX "EmployeeInvitation_employeeId_status_idx" ON "EmployeeInvitation"("employeeId", "status");

-- CreateIndex
CREATE INDEX "EmployeeInvitation_expiresAt_status_idx" ON "EmployeeInvitation"("expiresAt", "status");

-- CreateIndex
CREATE INDEX "EmployeeInvitation_inviterMembershipId_createdAt_idx" ON "EmployeeInvitation"("inviterMembershipId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_businessId_id_key" ON "Membership"("businessId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_businessId_email_key" ON "Employee"("businessId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_businessId_userId_key" ON "Employee"("businessId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_businessId_id_key" ON "Employee"("businessId", "id");

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_businessId_userId_fkey" FOREIGN KEY ("businessId", "userId") REFERENCES "Membership"("businessId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeInvitation" ADD CONSTRAINT "EmployeeInvitation_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeInvitation" ADD CONSTRAINT "EmployeeInvitation_businessId_employeeId_fkey" FOREIGN KEY ("businessId", "employeeId") REFERENCES "Employee"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeInvitation" ADD CONSTRAINT "EmployeeInvitation_businessId_inviterMembershipId_inviterU_fkey" FOREIGN KEY ("businessId", "inviterMembershipId", "inviterUserId") REFERENCES "Membership"("businessId", "id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeInvitation" ADD CONSTRAINT "EmployeeInvitation_businessId_acceptedByMembershipId_fkey" FOREIGN KEY ("businessId", "acceptedByMembershipId") REFERENCES "Membership"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeInvitation" ADD CONSTRAINT "EmployeeInvitation_businessId_revokedByMembershipId_fkey" FOREIGN KEY ("businessId", "revokedByMembershipId") REFERENCES "Membership"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Invitation integrity rules that Prisma's schema language cannot express.
ALTER TABLE "Employee"
  ADD CONSTRAINT "Employee_email_normalized_check"
  CHECK ("email" IS NULL OR ("email" = lower("email") AND "email" = btrim("email") AND "email" <> ''));

ALTER TABLE "EmployeeInvitation"
  ADD CONSTRAINT "EmployeeInvitation_email_normalized_check"
  CHECK ("email" = lower("email") AND "email" = btrim("email") AND "email" <> ''),
  ADD CONSTRAINT "EmployeeInvitation_role_not_owner_check"
  CHECK ("role" <> 'OWNER'::"MembershipRole"),
  ADD CONSTRAINT "EmployeeInvitation_tokenHash_sha256_check"
  CHECK ("tokenHash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "EmployeeInvitation_expiresAt_after_createdAt_check"
  CHECK ("expiresAt" > "createdAt"),
  ADD CONSTRAINT "EmployeeInvitation_status_metadata_check"
  CHECK (
    ("status" = 'PENDING'
      AND "acceptedAt" IS NULL AND "acceptedByMembershipId" IS NULL
      AND "expiredAt" IS NULL
      AND "revokedAt" IS NULL AND "revokedByMembershipId" IS NULL)
    OR ("status" = 'ACCEPTED'
      AND "acceptedAt" IS NOT NULL AND "acceptedByMembershipId" IS NOT NULL
      AND "expiredAt" IS NULL
      AND "revokedAt" IS NULL AND "revokedByMembershipId" IS NULL)
    OR ("status" = 'EXPIRED'
      AND "acceptedAt" IS NULL AND "acceptedByMembershipId" IS NULL
      AND "expiredAt" IS NOT NULL AND "expiredAt" >= "expiresAt"
      AND "revokedAt" IS NULL AND "revokedByMembershipId" IS NULL)
    OR ("status" = 'REVOKED'
      AND "acceptedAt" IS NULL AND "acceptedByMembershipId" IS NULL
      AND "expiredAt" IS NULL
      AND "revokedAt" IS NOT NULL AND "revokedByMembershipId" IS NOT NULL)
  );

-- At most one invitation in the PENDING lifecycle state per employee.
-- Expired pending invitations must be transitioned to EXPIRED before issuing a replacement.
CREATE UNIQUE INDEX "EmployeeInvitation_one_pending_per_employee_key"
  ON "EmployeeInvitation" ("employeeId")
  WHERE "status" = 'PENDING'::"EmployeeInvitationStatus";
