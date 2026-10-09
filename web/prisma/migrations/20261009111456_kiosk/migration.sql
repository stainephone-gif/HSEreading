-- CreateTable
CREATE TABLE "KioskExport" (
    "id" TEXT NOT NULL,
    "textId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "publicKey" BYTEA NOT NULL,
    "secretKey" BYTEA NOT NULL,
    "macKey" BYTEA NOT NULL,
    "localKey" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KioskExport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KioskReport" (
    "id" TEXT NOT NULL,
    "exportId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "savedAt" TIMESTAMP(3) NOT NULL,
    "readCount" INTEGER NOT NULL,
    "answerCount" INTEGER NOT NULL,
    "digest" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KioskReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KioskExport_textId_idx" ON "KioskExport"("textId");

-- CreateIndex
CREATE UNIQUE INDEX "KioskReport_digest_key" ON "KioskReport"("digest");

-- CreateIndex
CREATE INDEX "KioskReport_exportId_userId_idx" ON "KioskReport"("exportId", "userId");

-- AddForeignKey
ALTER TABLE "KioskExport" ADD CONSTRAINT "KioskExport_textId_fkey" FOREIGN KEY ("textId") REFERENCES "Text"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KioskExport" ADD CONSTRAINT "KioskExport_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KioskReport" ADD CONSTRAINT "KioskReport_exportId_fkey" FOREIGN KEY ("exportId") REFERENCES "KioskExport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KioskReport" ADD CONSTRAINT "KioskReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
