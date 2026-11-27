-- Add a per-user language preference. Existing users default to English.
CREATE TYPE "UserLanguage" AS ENUM ('en', 'am');

ALTER TABLE "User"
  ADD COLUMN "language" "UserLanguage" NOT NULL DEFAULT 'en';
