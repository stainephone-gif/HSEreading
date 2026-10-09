-- AlterTable
ALTER TABLE "Text" ADD COLUMN     "publishedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ReadingCursor" (
    "userId" TEXT NOT NULL,
    "textId" TEXT NOT NULL,
    "firstOpenedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastBeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReadingCursor_pkey" PRIMARY KEY ("userId","textId")
);

-- CreateTable
CREATE TABLE "Dwell" (
    "userId" TEXT NOT NULL,
    "fragmentId" TEXT NOT NULL,
    "ms" INTEGER NOT NULL DEFAULT 0,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "Dwell_pkey" PRIMARY KEY ("userId","fragmentId")
);

-- CreateIndex
CREATE INDEX "Dwell_fragmentId_idx" ON "Dwell"("fragmentId");

-- AddForeignKey
ALTER TABLE "ReadingCursor" ADD CONSTRAINT "ReadingCursor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadingCursor" ADD CONSTRAINT "ReadingCursor_textId_fkey" FOREIGN KEY ("textId") REFERENCES "Text"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dwell" ADD CONSTRAINT "Dwell_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dwell" ADD CONSTRAINT "Dwell_fragmentId_fkey" FOREIGN KEY ("fragmentId") REFERENCES "Fragment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
