-- CreateEnum
CREATE TYPE "AccountKind" AS ENUM ('user', 'org');

-- CreateEnum
CREATE TYPE "OrgRole" AS ENUM ('owner', 'admin', 'contributor', 'reader');

-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('free', 'pro', 'teams');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('active', 'trialing', 'past_due', 'canceled');

-- CreateEnum
CREATE TYPE "ExtensionVisibility" AS ENUM ('public', 'private');

-- CreateEnum
CREATE TYPE "ExtensionStatus" AS ENUM ('active', 'archived', 'dmca_holding');

-- CreateEnum
CREATE TYPE "ExtensionAvailability" AS ENUM ('available', 'planned');

-- CreateTable
CREATE TABLE "namespace_handles" (
    "id" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "kind" "AccountKind" NOT NULL,
    "ownerId" TEXT NOT NULL,
    "reserved" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "namespace_handles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "avatarSeed" TEXT NOT NULL,
    "bio" TEXT,
    "location" TEXT,
    "website" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subscriptionId" TEXT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "website" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subscriptionId" TEXT,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "OrgRole" NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "plan" "Plan" NOT NULL DEFAULT 'free',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'active',
    "subjectUserId" TEXT,
    "subjectOrgId" TEXT,
    "seats" INTEGER NOT NULL DEFAULT 1,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "stripeCustomerId" TEXT,
    "stripeSubId" TEXT,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "scopes" TEXT[],
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "api_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extensions" (
    "id" TEXT NOT NULL,
    "ownerHandle" TEXT NOT NULL,
    "ownerKind" "AccountKind" NOT NULL,
    "ownerId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "visibility" "ExtensionVisibility" NOT NULL DEFAULT 'public',
    "status" "ExtensionStatus" NOT NULL DEFAULT 'active',
    "availability" "ExtensionAvailability" NOT NULL DEFAULT 'available',
    "tags" TEXT[],
    "repositoryUrl" TEXT,
    "readme" TEXT,
    "latestVersion" TEXT,
    "downloads" BIGINT NOT NULL DEFAULT 0,
    "stars" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "extensions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "versions" (
    "id" TEXT NOT NULL,
    "extensionId" TEXT NOT NULL,
    "semver" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bundleSha256" TEXT NOT NULL,
    "bundleSize" BIGINT NOT NULL,
    "bundleMimeType" TEXT NOT NULL DEFAULT 'application/vnd.oxp.bundle.v1.tar+zstd',
    "signedByUserId" TEXT NOT NULL,
    "signatureKeyId" TEXT NOT NULL,
    "signatureAlgo" TEXT NOT NULL DEFAULT 'ed25519',
    "signatureJson" JSONB NOT NULL,
    "manifestJson" JSONB NOT NULL,
    "yankedAt" TIMESTAMP(3),
    "changelog" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publisher_keys" (
    "id" TEXT NOT NULL,
    "publisherHandle" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL DEFAULT 'ed25519',
    "publicKeyPem" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "registeredByUserId" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "publisher_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extension_aliases" (
    "id" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "extensionId" TEXT NOT NULL,
    "ownerHandle" TEXT NOT NULL,
    "slug" TEXT NOT NULL,

    CONSTRAINT "extension_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "installs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "extensionId" TEXT NOT NULL,
    "editor" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "installs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stars" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "extensionId" TEXT NOT NULL,
    "starredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mcp_server_snapshots" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "publisher" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "homepage" TEXT,
    "repository" TEXT,
    "transports" TEXT[],
    "tags" TEXT[],
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,

    CONSTRAINT "mcp_server_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "namespace_handles_handle_key" ON "namespace_handles"("handle");

-- CreateIndex
CREATE INDEX "namespace_handles_ownerId_idx" ON "namespace_handles"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "users_handle_key" ON "users"("handle");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_subscriptionId_key" ON "users"("subscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_handle_key" ON "organizations"("handle");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_subscriptionId_key" ON "organizations"("subscriptionId");

-- CreateIndex
CREATE INDEX "memberships_userId_idx" ON "memberships"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_orgId_userId_key" ON "memberships"("orgId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_subjectUserId_key" ON "subscriptions"("subjectUserId");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_subjectOrgId_key" ON "subscriptions"("subjectOrgId");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_stripeCustomerId_key" ON "subscriptions"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_stripeSubId_key" ON "subscriptions"("stripeSubId");

-- CreateIndex
CREATE UNIQUE INDEX "api_tokens_tokenHash_key" ON "api_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "api_tokens_userId_idx" ON "api_tokens"("userId");

-- CreateIndex
CREATE INDEX "extensions_ownerId_idx" ON "extensions"("ownerId");

-- CreateIndex
CREATE INDEX "extensions_visibility_status_idx" ON "extensions"("visibility", "status");

-- CreateIndex
CREATE UNIQUE INDEX "extensions_ownerHandle_slug_key" ON "extensions"("ownerHandle", "slug");

-- CreateIndex
CREATE INDEX "versions_bundleSha256_idx" ON "versions"("bundleSha256");

-- CreateIndex
CREATE UNIQUE INDEX "versions_extensionId_semver_key" ON "versions"("extensionId", "semver");

-- CreateIndex
CREATE UNIQUE INDEX "publisher_keys_keyId_key" ON "publisher_keys"("keyId");

-- CreateIndex
CREATE INDEX "publisher_keys_publisherHandle_revokedAt_idx" ON "publisher_keys"("publisherHandle", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "extension_aliases_alias_key" ON "extension_aliases"("alias");

-- CreateIndex
CREATE INDEX "installs_extensionId_idx" ON "installs"("extensionId");

-- CreateIndex
CREATE UNIQUE INDEX "installs_userId_extensionId_editor_key" ON "installs"("userId", "extensionId", "editor");

-- CreateIndex
CREATE INDEX "stars_extensionId_idx" ON "stars"("extensionId");

-- CreateIndex
CREATE UNIQUE INDEX "stars_userId_extensionId_key" ON "stars"("userId", "extensionId");

-- CreateIndex
CREATE INDEX "mcp_server_snapshots_publisher_idx" ON "mcp_server_snapshots"("publisher");

-- CreateIndex
CREATE INDEX "audit_events_subject_createdAt_idx" ON "audit_events"("subject", "createdAt");

-- CreateIndex
CREATE INDEX "audit_events_actorId_createdAt_idx" ON "audit_events"("actorId", "createdAt");

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "versions" ADD CONSTRAINT "versions_extensionId_fkey" FOREIGN KEY ("extensionId") REFERENCES "extensions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extension_aliases" ADD CONSTRAINT "extension_aliases_extensionId_fkey" FOREIGN KEY ("extensionId") REFERENCES "extensions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installs" ADD CONSTRAINT "installs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installs" ADD CONSTRAINT "installs_extensionId_fkey" FOREIGN KEY ("extensionId") REFERENCES "extensions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stars" ADD CONSTRAINT "stars_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stars" ADD CONSTRAINT "stars_extensionId_fkey" FOREIGN KEY ("extensionId") REFERENCES "extensions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
