-- Archiving: rows leave the working view without leaving the database.
ALTER TABLE "ClubApplication"
  ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "archivedAt" TIMESTAMP(3);

ALTER TABLE "Signup"
  ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "archivedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "ClubApplication_archived_idx" ON "ClubApplication"("archived");
CREATE INDEX "Signup_archived_idx" ON "Signup"("archived");
