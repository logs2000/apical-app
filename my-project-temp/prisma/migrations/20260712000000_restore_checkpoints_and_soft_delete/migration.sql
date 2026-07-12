-- AlterTable
ALTER TABLE "UserAsset" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "RestoreCheckpoint" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agentId" TEXT,
    "runId" TEXT,
    "messageId" TEXT,
    "label" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',

    CONSTRAINT "RestoreCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileSnapshot" (
    "id" TEXT NOT NULL,
    "checkpointId" TEXT NOT NULL,
    "op" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "fromPath" TEXT,
    "existedBefore" BOOLEAN NOT NULL DEFAULT true,
    "priorStorageKey" TEXT,
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RestoreCheckpoint_userId_createdAt_idx" ON "RestoreCheckpoint"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "RestoreCheckpoint_agentId_createdAt_idx" ON "RestoreCheckpoint"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "RestoreCheckpoint_messageId_idx" ON "RestoreCheckpoint"("messageId");

-- CreateIndex
CREATE INDEX "RestoreCheckpoint_expiresAt_idx" ON "RestoreCheckpoint"("expiresAt");

-- CreateIndex
CREATE INDEX "FileSnapshot_checkpointId_idx" ON "FileSnapshot"("checkpointId");

-- CreateIndex
CREATE INDEX "UserAsset_deletedAt_idx" ON "UserAsset"("deletedAt");

-- AddForeignKey
ALTER TABLE "FileSnapshot" ADD CONSTRAINT "FileSnapshot_checkpointId_fkey" FOREIGN KEY ("checkpointId") REFERENCES "RestoreCheckpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

