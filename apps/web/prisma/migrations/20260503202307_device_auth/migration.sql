-- CreateTable
CREATE TABLE "device_auth" (
    "id" TEXT NOT NULL,
    "deviceCodeHash" TEXT NOT NULL,
    "userCode" TEXT NOT NULL,
    "requestedScopes" TEXT[],
    "userId" TEXT,
    "deniedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "tokenId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_auth_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "device_auth_deviceCodeHash_key" ON "device_auth"("deviceCodeHash");

-- CreateIndex
CREATE UNIQUE INDEX "device_auth_userCode_key" ON "device_auth"("userCode");

-- CreateIndex
CREATE UNIQUE INDEX "device_auth_tokenId_key" ON "device_auth"("tokenId");

-- CreateIndex
CREATE INDEX "device_auth_userId_idx" ON "device_auth"("userId");

-- AddForeignKey
ALTER TABLE "device_auth" ADD CONSTRAINT "device_auth_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_auth" ADD CONSTRAINT "device_auth_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "api_tokens"("id") ON DELETE SET NULL ON UPDATE CASCADE;
