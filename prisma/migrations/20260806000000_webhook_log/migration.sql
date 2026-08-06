-- Webhook receipts, so a silent failure can be told from a missing delivery.
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" TEXT NOT NULL,
    "sessionId" TEXT,
    "outcome" TEXT NOT NULL,
    "detail" TEXT,
    "stored" BOOLEAN NOT NULL DEFAULT false,
    "emailedTo" TEXT,
    "emailStatus" TEXT,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebhookEvent_createdAt_idx" ON "WebhookEvent"("createdAt");
CREATE INDEX "WebhookEvent_outcome_idx" ON "WebhookEvent"("outcome");
