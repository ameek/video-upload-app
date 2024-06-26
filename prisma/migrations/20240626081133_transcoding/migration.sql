/*
  Warnings:

  - You are about to drop the column `trasncodingJobStatus` on the `Video` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `Video` DROP COLUMN `trasncodingJobStatus`,
    ADD COLUMN `transcodingJobStatus` VARCHAR(191) NULL;
