-- CreateEnum
CREATE TYPE "TextStatus" AS ENUM ('PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "DisplayMode" AS ENUM ('PDF', 'WEB');

-- CreateEnum
CREATE TYPE "FragmentKind" AS ENUM ('BODY', 'HEADING', 'EXCLUDED');

-- CreateTable
CREATE TABLE "Text" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "TextStatus" NOT NULL DEFAULT 'PROCESSING',
    "error" TEXT,
    "pdfKey" TEXT NOT NULL,
    "pdfName" TEXT NOT NULL,
    "pageCount" INTEGER NOT NULL DEFAULT 0,
    "pages" JSONB NOT NULL DEFAULT '[]',
    "language" TEXT,
    "displayMode" "DisplayMode" NOT NULL DEFAULT 'PDF',
    "wordsPerMinute" INTEGER NOT NULL DEFAULT 200,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Text_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fragment" (
    "id" TEXT NOT NULL,
    "textId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "FragmentKind" NOT NULL,
    "content" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "wordCount" INTEGER NOT NULL,
    "lines" JSONB NOT NULL,
    "sentences" JSONB NOT NULL,
    "excludeReason" TEXT,

    CONSTRAINT "Fragment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Text_courseId_idx" ON "Text"("courseId");

-- CreateIndex
CREATE INDEX "Fragment_textId_position_idx" ON "Fragment"("textId", "position");

-- AddForeignKey
ALTER TABLE "Text" ADD CONSTRAINT "Text_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Text" ADD CONSTRAINT "Text_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fragment" ADD CONSTRAINT "Fragment_textId_fkey" FOREIGN KEY ("textId") REFERENCES "Text"("id") ON DELETE CASCADE ON UPDATE CASCADE;
