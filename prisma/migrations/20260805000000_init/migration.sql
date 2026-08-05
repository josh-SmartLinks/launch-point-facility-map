-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Signup" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "stripeSessionId" TEXT NOT NULL,
    "paymentIntentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "club" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "tour" TEXT NOT NULL,
    "playerName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "buyInCents" INTEGER NOT NULL,
    "feeCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "Signup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClubApplication" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "facility" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "launchMonitor" TEXT NOT NULL,
    "interest" TEXT NOT NULL,
    "notes" TEXT,
    "platform" TEXT,

    CONSTRAINT "ClubApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Signup_stripeSessionId_key" ON "Signup"("stripeSessionId");

-- CreateIndex
CREATE INDEX "Signup_tour_platform_idx" ON "Signup"("tour", "platform");

-- CreateIndex
CREATE INDEX "Signup_club_idx" ON "Signup"("club");

-- CreateIndex
CREATE INDEX "Signup_status_idx" ON "Signup"("status");

-- CreateIndex
CREATE INDEX "ClubApplication_interest_idx" ON "ClubApplication"("interest");

-- CreateIndex
CREATE INDEX "ClubApplication_createdAt_idx" ON "ClubApplication"("createdAt");

