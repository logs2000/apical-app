-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "passwordHash" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'credentials',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "Integration" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "registrySlug" TEXT,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "config" TEXT NOT NULL,
    "tools" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'connected',
    "category" TEXT NOT NULL DEFAULT 'general',
    "color" TEXT NOT NULL DEFAULT 'emerald',
    "source" TEXT NOT NULL DEFAULT 'builtin',
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "authorLabel" TEXT,
    "installs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Integration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workflow" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "stepsJson" TEXT NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'manual',
    "schedule" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "workspaceId" TEXT,
    "runtime" TEXT NOT NULL DEFAULT 'hosted',
    "parentAgentId" TEXT,
    "runsCount" INTEGER NOT NULL DEFAULT 0,
    "itemsProcessed" INTEGER NOT NULL DEFAULT 0,
    "automaticCount" INTEGER NOT NULL DEFAULT 0,
    "flaggedCount" INTEGER NOT NULL DEFAULT 0,
    "aiCallsSaved" INTEGER NOT NULL DEFAULT 0,
    "estCostSavedCents" INTEGER NOT NULL DEFAULT 0,
    "origin" TEXT NOT NULL DEFAULT 'agent',
    "modelPreference" TEXT,
    "confidenceThreshold" DOUBLE PRECISION,
    "autoHardenAfter" INTEGER,
    "allowedToolsJson" TEXT,
    "allowedCredentialsJson" TEXT,
    "activeRevisionId" TEXT,
    "triggerSecret" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowRevision" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "stepsJson" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "author" TEXT NOT NULL DEFAULT 'user',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentMessage" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "eventsJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentData" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "valueJson" TEXT,
    "filePath" TEXT,
    "metaJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentData_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserAsset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "agentId" TEXT,
    "conversationId" TEXT,
    "messageId" TEXT,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'application/octet-stream',
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "storageKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'file',
    "source" TEXT NOT NULL DEFAULT 'upload',
    "localPath" TEXT,
    "metaJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Run" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "trigger" TEXT NOT NULL DEFAULT 'manual',
    "connectedAccountId" TEXT,
    "revisionId" TEXT,
    "idempotencyKey" TEXT,
    "rerunOfRunId" TEXT,
    "itemsProcessed" INTEGER NOT NULL DEFAULT 0,
    "automaticCount" INTEGER NOT NULL DEFAULT 0,
    "flaggedCount" INTEGER NOT NULL DEFAULT 0,
    "aiCallsUsed" INTEGER NOT NULL DEFAULT 0,
    "aiCallsSaved" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "reportJson" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenerateJob" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT,
    "spec" TEXT NOT NULL,
    "name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "workflowId" TEXT,
    "error" TEXT,
    "issuesJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "GenerateJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrantedFolder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "path" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GrantedFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchedFolder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "workflowId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "pattern" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastScanAt" TIMESTAMP(3),
    "knownFilesJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WatchedFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEndpoint" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "eventsJson" TEXT NOT NULL DEFAULT '[]',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "responseStatus" INTEGER,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentWidget" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "dataJson" TEXT NOT NULL,
    "col" INTEGER NOT NULL DEFAULT 0,
    "ord" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentWidget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunStep" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "outputJson" TEXT,
    "aiTokens" INTEGER NOT NULL DEFAULT 0,
    "aiCostCents" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "order" INTEGER NOT NULL DEFAULT 0,
    "parentStepId" TEXT,
    "iterationIndex" INTEGER,

    CONSTRAINT "RunStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionPattern" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "outputJson" TEXT NOT NULL,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "hardened" BOOLEAN NOT NULL DEFAULT false,
    "ruleJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExecutionPattern_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Credential" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "workspaceId" TEXT,
    "connectedAccountId" TEXT,
    "service" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "metaJson" TEXT NOT NULL DEFAULT '{}',
    "agentProvisioned" BOOLEAN NOT NULL DEFAULT false,
    "canPay" BOOLEAN NOT NULL DEFAULT false,
    "oauthProvider" TEXT,
    "oauthAccessToken" TEXT,
    "oauthRefreshToken" TEXT,
    "oauthExpiresAt" TIMESTAMP(3),
    "pipedreamAccountId" TEXT,
    "pipedreamApp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Credential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthProvider" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT 'general',
    "description" TEXT NOT NULL DEFAULT '',
    "authorizationUrl" TEXT NOT NULL,
    "tokenUrl" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "clientId" TEXT NOT NULL DEFAULT '',
    "clientSecret" TEXT NOT NULL DEFAULT '',
    "supportsCustomCreds" BOOLEAN NOT NULL DEFAULT true,
    "demoMode" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OAuthProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "title" TEXT NOT NULL DEFAULT 'New conversation',
    "workspaceId" TEXT,
    "messagesJson" TEXT NOT NULL DEFAULT '[]',
    "summaryJson" TEXT NOT NULL DEFAULT '{}',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "color" TEXT NOT NULL DEFAULT 'emerald',
    "plan" TEXT NOT NULL DEFAULT 'free',
    "balanceCents" INTEGER NOT NULL DEFAULT 0,
    "billingEmail" TEXT,
    "stripeCustomerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceMember" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'owner',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "companyName" TEXT NOT NULL DEFAULT '',
    "industry" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "dataSourcesJson" TEXT NOT NULL DEFAULT '[]',
    "timezone" TEXT NOT NULL DEFAULT '',
    "locale" TEXT NOT NULL DEFAULT '',
    "country" TEXT NOT NULL DEFAULT '',
    "region" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL DEFAULT '',
    "agentNameStyle" TEXT NOT NULL DEFAULT 'descriptive',
    "notificationPrefsJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceApiKey" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdById" TEXT,
    "label" TEXT NOT NULL DEFAULT 'Default',
    "keyHash" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "scopesJson" TEXT NOT NULL DEFAULT '[]',
    "spendLimitCents" INTEGER NOT NULL DEFAULT 0,
    "spentCents" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "lastUsedFrom" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceAuditLog" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "apiKeyId" TEXT,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "detail" TEXT,
    "source" TEXT NOT NULL DEFAULT 'rest',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "status" TEXT NOT NULL DEFAULT 'active',
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "stripePriceId" TEXT,
    "currentPeriodEnd" TIMESTAMP(3),
    "tokenAllowanceMonthly" INTEGER NOT NULL DEFAULT 0,
    "tokenUsedMonthly" INTEGER NOT NULL DEFAULT 0,
    "tokenOverageMonthly" INTEGER NOT NULL DEFAULT 0,
    "overrunEnabled" BOOLEAN NOT NULL DEFAULT false,
    "overrunRateCentsPer1M" INTEGER NOT NULL DEFAULT 0,
    "overageAccruedCents" INTEGER NOT NULL DEFAULT 0,
    "seats" INTEGER NOT NULL DEFAULT 1,
    "canceledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TokenUsageRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'chat',
    "refId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenUsageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ByokKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT 'Default',
    "encryptedKey" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "baseUrl" TEXT,
    "defaultModel" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastUsedAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ByokKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomModel" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'online',
    "provider" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "baseUrl" TEXT,
    "byokKeyId" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "contextWindow" INTEGER NOT NULL DEFAULT 128000,
    "inputCostCentsPer1M" INTEGER NOT NULL DEFAULT 0,
    "outputCostCentsPer1M" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "workflowId" TEXT NOT NULL,
    "schedule" TEXT NOT NULL,
    "scheduleKind" TEXT NOT NULL DEFAULT 'cron',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "status" TEXT NOT NULL DEFAULT 'active',
    "pausedByUserToggle" BOOLEAN NOT NULL DEFAULT false,
    "offlinePolicy" TEXT NOT NULL DEFAULT 'skip',
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "lastRunStatus" TEXT,
    "lastRunId" TEXT,
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataTable" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "columnsJson" TEXT NOT NULL DEFAULT '[]',
    "sourceWorkflowId" TEXT,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataTableRow" (
    "id" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "rowJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataTableRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "encryptedConfig" TEXT NOT NULL,
    "metaJson" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastStatus" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL DEFAULT 'system',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "refId" TEXT,
    "errorMessage" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DesktopSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT 'My Desktop',
    "platform" TEXT,
    "arch" TEXT,
    "appVersion" TEXT,
    "sessionToken" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'offline',
    "lastSeenAt" TIMESTAMP(3),
    "capabilitiesJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DesktopSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceAuthRequest" (
    "id" TEXT NOT NULL,
    "deviceCodeHash" TEXT NOT NULL,
    "userCode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "label" TEXT NOT NULL DEFAULT 'My Desktop',
    "platform" TEXT,
    "arch" TEXT,
    "appVersion" TEXT,
    "userId" TEXT,
    "desktopSessionId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceAuthRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConnectorCatalogEntry" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "description" TEXT NOT NULL,
    "shortDesc" TEXT NOT NULL DEFAULT '',
    "icon" TEXT NOT NULL DEFAULT '',
    "configSchemaJson" TEXT NOT NULL DEFAULT '{}',
    "toolsJson" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'live',
    "source" TEXT NOT NULL DEFAULT 'internal',
    "authorLabel" TEXT,
    "installCount" INTEGER NOT NULL DEFAULT 0,
    "oauthProviderKey" TEXT,
    "apiBaseUrl" TEXT,
    "mcpServerUrl" TEXT,
    "pipedreamAppSlug" TEXT,
    "authType" TEXT,
    "imgSrc" TEXT,
    "docsUrl" TEXT,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "supportsByoc" BOOLEAN NOT NULL DEFAULT true,
    "hasDemoMode" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConnectorCatalogEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConnectedAccount" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "externalRef" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'active',
    "metaJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConnectedAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "serviceSlug" TEXT NOT NULL,
    "sessionType" TEXT NOT NULL,
    "encryptedData" TEXT NOT NULL,
    "metaJson" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'active',
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "userApproved" BOOLEAN NOT NULL DEFAULT false,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "agentId" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'chat',
    "parentRunId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "goal" TEXT NOT NULL,
    "optsJson" TEXT NOT NULL DEFAULT '{}',
    "checkpointJson" TEXT,
    "finalJson" TEXT,
    "error" TEXT,
    "claimedBy" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "iterations" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRunEvent" (
    "id" TEXT NOT NULL,
    "agentRunId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "dataJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentRunEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "agentId" TEXT,
    "agentRunId" TEXT,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'script',
    "backend" TEXT NOT NULL DEFAULT 'server',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "payloadJson" TEXT NOT NULL DEFAULT '{}',
    "timeoutMs" INTEGER NOT NULL DEFAULT 1800000,
    "progress" DOUBLE PRECISION,
    "progressNote" TEXT,
    "resultJson" TEXT,
    "error" TEXT,
    "artifactIdsJson" TEXT,
    "desktopSessionId" TEXT,
    "claimedBy" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Skill" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "paramsSchemaJson" TEXT NOT NULL DEFAULT '{"type":"object","properties":{}}',
    "specJson" TEXT NOT NULL,
    "docsMd" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "activeVersionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "sourceAgentId" TEXT,
    "timesUsed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Skill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkillVersion" (
    "id" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "specJson" TEXT NOT NULL,
    "paramsSchemaJson" TEXT NOT NULL,
    "docsMd" TEXT,
    "author" TEXT NOT NULL DEFAULT 'agent',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SkillVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemoryEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "agentId" TEXT,
    "kind" TEXT NOT NULL,
    "subject" TEXT,
    "content" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "timesReinforced" INTEGER NOT NULL DEFAULT 1,
    "sourceKind" TEXT NOT NULL DEFAULT 'chat',
    "sourceId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemoryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthState" (
    "state" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "customClientId" TEXT,
    "customClientSecret" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthState_pkey" PRIMARY KEY ("state")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE INDEX "Integration_workspaceId_idx" ON "Integration"("workspaceId");

-- CreateIndex
CREATE INDEX "WorkflowRevision_workflowId_createdAt_idx" ON "WorkflowRevision"("workflowId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowRevision_workflowId_number_key" ON "WorkflowRevision"("workflowId", "number");

-- CreateIndex
CREATE INDEX "AgentMessage_agentId_createdAt_idx" ON "AgentMessage"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentData_agentId_kind_idx" ON "AgentData"("agentId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "AgentData_agentId_kind_key_key" ON "AgentData"("agentId", "kind", "key");

-- CreateIndex
CREATE INDEX "UserAsset_userId_createdAt_idx" ON "UserAsset"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "UserAsset_agentId_idx" ON "UserAsset"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "Run_workflowId_idempotencyKey_key" ON "Run"("workflowId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "GenerateJob_workspaceId_idx" ON "GenerateJob"("workspaceId");

-- CreateIndex
CREATE INDEX "GrantedFolder_userId_idx" ON "GrantedFolder"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "GrantedFolder_userId_path_key" ON "GrantedFolder"("userId", "path");

-- CreateIndex
CREATE INDEX "WatchedFolder_status_idx" ON "WatchedFolder"("status");

-- CreateIndex
CREATE INDEX "WatchedFolder_userId_idx" ON "WatchedFolder"("userId");

-- CreateIndex
CREATE INDEX "Credential_pipedreamAccountId_idx" ON "Credential"("pipedreamAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthProvider_key_key" ON "OAuthProvider"("key");

-- CreateIndex
CREATE INDEX "WorkspaceMember_userId_idx" ON "WorkspaceMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceMember_workspaceId_userId_key" ON "WorkspaceMember"("workspaceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserProfile_userId_key" ON "UserProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceApiKey_keyHash_key" ON "WorkspaceApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "WorkspaceApiKey_workspaceId_idx" ON "WorkspaceApiKey"("workspaceId");

-- CreateIndex
CREATE INDEX "WorkspaceAuditLog_workspaceId_createdAt_idx" ON "WorkspaceAuditLog"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_userId_key" ON "Subscription"("userId");

-- CreateIndex
CREATE INDEX "TokenUsageRecord_userId_createdAt_idx" ON "TokenUsageRecord"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "TokenUsageRecord_userId_provider_idx" ON "TokenUsageRecord"("userId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "ByokKey_userId_provider_label_key" ON "ByokKey"("userId", "provider", "label");

-- CreateIndex
CREATE INDEX "CustomModel_userId_idx" ON "CustomModel"("userId");

-- CreateIndex
CREATE INDEX "ScheduledJob_nextRunAt_status_idx" ON "ScheduledJob"("nextRunAt", "status");

-- CreateIndex
CREATE INDEX "ScheduledJob_userId_idx" ON "ScheduledJob"("userId");

-- CreateIndex
CREATE INDEX "DataTable_userId_idx" ON "DataTable"("userId");

-- CreateIndex
CREATE INDEX "DataTableRow_tableId_idx" ON "DataTableRow"("tableId");

-- CreateIndex
CREATE INDEX "DataConnection_userId_kind_idx" ON "DataConnection"("userId", "kind");

-- CreateIndex
CREATE INDEX "EmailLog_userId_createdAt_idx" ON "EmailLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "EmailLog_status_idx" ON "EmailLog"("status");

-- CreateIndex
CREATE UNIQUE INDEX "DesktopSession_sessionToken_key" ON "DesktopSession"("sessionToken");

-- CreateIndex
CREATE INDEX "DesktopSession_userId_status_idx" ON "DesktopSession"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceAuthRequest_deviceCodeHash_key" ON "DeviceAuthRequest"("deviceCodeHash");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceAuthRequest_userCode_key" ON "DeviceAuthRequest"("userCode");

-- CreateIndex
CREATE INDEX "DeviceAuthRequest_status_expiresAt_idx" ON "DeviceAuthRequest"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConnectorCatalogEntry_slug_key" ON "ConnectorCatalogEntry"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "ConnectorCatalogEntry_pipedreamAppSlug_key" ON "ConnectorCatalogEntry"("pipedreamAppSlug");

-- CreateIndex
CREATE INDEX "ConnectorCatalogEntry_category_idx" ON "ConnectorCatalogEntry"("category");

-- CreateIndex
CREATE INDEX "ConnectorCatalogEntry_kind_idx" ON "ConnectorCatalogEntry"("kind");

-- CreateIndex
CREATE INDEX "ConnectorCatalogEntry_status_idx" ON "ConnectorCatalogEntry"("status");

-- CreateIndex
CREATE INDEX "ConnectorCatalogEntry_source_idx" ON "ConnectorCatalogEntry"("source");

-- CreateIndex
CREATE INDEX "ConnectedAccount_workspaceId_idx" ON "ConnectedAccount"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "ConnectedAccount_workspaceId_externalRef_key" ON "ConnectedAccount"("workspaceId", "externalRef");

-- CreateIndex
CREATE INDEX "IntegrationSession_userId_serviceSlug_idx" ON "IntegrationSession"("userId", "serviceSlug");

-- CreateIndex
CREATE INDEX "IntegrationSession_status_idx" ON "IntegrationSession"("status");

-- CreateIndex
CREATE INDEX "AgentRun_status_createdAt_idx" ON "AgentRun"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_userId_createdAt_idx" ON "AgentRun"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_agentId_createdAt_idx" ON "AgentRun"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_parentRunId_idx" ON "AgentRun"("parentRunId");

-- CreateIndex
CREATE INDEX "AgentRunEvent_agentRunId_seq_idx" ON "AgentRunEvent"("agentRunId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "AgentRunEvent_agentRunId_seq_key" ON "AgentRunEvent"("agentRunId", "seq");

-- CreateIndex
CREATE INDEX "Job_status_backend_idx" ON "Job"("status", "backend");

-- CreateIndex
CREATE INDEX "Job_userId_createdAt_idx" ON "Job"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Job_agentRunId_idx" ON "Job"("agentRunId");

-- CreateIndex
CREATE INDEX "Skill_userId_status_idx" ON "Skill"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Skill_userId_name_key" ON "Skill"("userId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "SkillVersion_skillId_number_key" ON "SkillVersion"("skillId", "number");

-- CreateIndex
CREATE INDEX "MemoryEntry_userId_status_kind_idx" ON "MemoryEntry"("userId", "status", "kind");

-- CreateIndex
CREATE INDEX "MemoryEntry_agentId_status_idx" ON "MemoryEntry"("agentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MemoryEntry_userId_kind_subject_key" ON "MemoryEntry"("userId", "kind", "subject");

-- CreateIndex
CREATE INDEX "OAuthState_expiresAt_idx" ON "OAuthState"("expiresAt");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workflow" ADD CONSTRAINT "Workflow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRevision" ADD CONSTRAINT "WorkflowRevision_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentMessage" ADD CONSTRAINT "AgentMessage_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentData" ADD CONSTRAINT "AgentData_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAsset" ADD CONSTRAINT "UserAsset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAsset" ADD CONSTRAINT "UserAsset_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Workflow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "WebhookEndpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunStep" ADD CONSTRAINT "RunStep_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionPattern" ADD CONSTRAINT "ExecutionPattern_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserProfile" ADD CONSTRAINT "UserProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceApiKey" ADD CONSTRAINT "WorkspaceApiKey_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceAuditLog" ADD CONSTRAINT "WorkspaceAuditLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceAuditLog" ADD CONSTRAINT "WorkspaceAuditLog_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "WorkspaceApiKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenUsageRecord" ADD CONSTRAINT "TokenUsageRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ByokKey" ADD CONSTRAINT "ByokKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomModel" ADD CONSTRAINT "CustomModel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledJob" ADD CONSTRAINT "ScheduledJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataTable" ADD CONSTRAINT "DataTable_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataTableRow" ADD CONSTRAINT "DataTableRow_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "DataTable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataConnection" ADD CONSTRAINT "DataConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailLog" ADD CONSTRAINT "EmailLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesktopSession" ADD CONSTRAINT "DesktopSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationSession" ADD CONSTRAINT "IntegrationSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRunEvent" ADD CONSTRAINT "AgentRunEvent_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillVersion" ADD CONSTRAINT "SkillVersion_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

