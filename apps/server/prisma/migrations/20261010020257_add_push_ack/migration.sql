-- CreateTable
CREATE TABLE "PushAck" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushAck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PushAck_messageId_idx" ON "PushAck"("messageId");

-- CreateIndex
CREATE INDEX "PushAck_userId_idx" ON "PushAck"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PushAck_messageId_userId_status_key" ON "PushAck"("messageId", "userId", "status");

-- AddForeignKey
ALTER TABLE "PushAck" ADD CONSTRAINT "PushAck_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushAck" ADD CONSTRAINT "PushAck_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
