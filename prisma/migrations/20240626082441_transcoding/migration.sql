/*
  Warnings:

  - A unique constraint covering the columns `[transcodingJobId]` on the table `Video` will be added. If there are existing duplicate values, this will fail.
  - Made the column `transcodingJobId` on table `Video` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE `Video` MODIFY `transcodingJobId` VARCHAR(191) NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Video_transcodingJobId_key` ON `Video`(`transcodingJobId`);
