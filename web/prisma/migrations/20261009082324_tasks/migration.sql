-- CreateEnum
CREATE TYPE "TaskMode" AS ENUM ('ANCHORED', 'SCATTERED');

-- CreateEnum
CREATE TYPE "AnswerFormat" AS ENUM ('CHOICE', 'SELECTION', 'SHORT');

-- CreateEnum
CREATE TYPE "Grade" AS ENUM ('PASS', 'FAIL');

-- AlterTable
ALTER TABLE "Text" ADD COLUMN     "deadline" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "textId" TEXT NOT NULL,
    "mode" "TaskMode" NOT NULL,
    "format" "AnswerFormat" NOT NULL,
    "prompt" TEXT NOT NULL,
    "fragmentId" TEXT,
    "sectionFragmentId" TEXT,
    "pageFrom" INTEGER,
    "pageTo" INTEGER,
    "options" JSONB,
    "answerRange" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskPlacement" (
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fragmentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskPlacement_pkey" PRIMARY KEY ("taskId","userId")
);

-- CreateTable
CREATE TABLE "Answer" (
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "grade" "Grade",
    "gradedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Answer_pkey" PRIMARY KEY ("taskId","userId")
);

-- CreateIndex
CREATE INDEX "Task_textId_idx" ON "Task"("textId");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_textId_fkey" FOREIGN KEY ("textId") REFERENCES "Text"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_fragmentId_fkey" FOREIGN KEY ("fragmentId") REFERENCES "Fragment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_sectionFragmentId_fkey" FOREIGN KEY ("sectionFragmentId") REFERENCES "Fragment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskPlacement" ADD CONSTRAINT "TaskPlacement_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskPlacement" ADD CONSTRAINT "TaskPlacement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskPlacement" ADD CONSTRAINT "TaskPlacement_fragmentId_fkey" FOREIGN KEY ("fragmentId") REFERENCES "Fragment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
