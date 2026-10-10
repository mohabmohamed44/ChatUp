/*
  Warnings:

  - You are about to drop the column `fcmToken` on the `Session` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Session" DROP COLUMN "fcmToken",
ADD COLUMN     "fid" TEXT;
