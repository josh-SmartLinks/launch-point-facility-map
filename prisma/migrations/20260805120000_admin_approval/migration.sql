-- Approval fields so a club submission can be published to the map.
ALTER TABLE "ClubApplication"
  ADD COLUMN "approved" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "mapName" TEXT,
  ADD COLUMN "lat" DOUBLE PRECISION,
  ADD COLUMN "lng" DOUBLE PRECISION;

-- CreateIndex
CREATE INDEX "ClubApplication_approved_idx" ON "ClubApplication"("approved");
