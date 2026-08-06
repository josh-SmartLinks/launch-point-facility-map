-- Partner pairing: the number a player gives, plus an admin override.
ALTER TABLE "Signup"
  ADD COLUMN "partnerPhone" TEXT,
  ADD COLUMN "partnerSignupId" TEXT;

-- CreateIndex
CREATE INDEX "Signup_phone_idx" ON "Signup"("phone");
