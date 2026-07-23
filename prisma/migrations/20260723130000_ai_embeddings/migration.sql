-- ResourceEmbedding / AiJob：AI 智能发布与撮合（Step 2）。向前兼容，仅新增。

-- pgvector 扩展（Neon 内置；需库 owner 权限）
CREATE EXTENSION IF NOT EXISTS vector;

-- 三类资源多态目标类型
CREATE TYPE "AiTargetType" AS ENUM ('ITEM', 'SERVICE', 'NEED');

-- AI 异步任务类型 / 状态
CREATE TYPE "AiJobType" AS ENUM ('EMBED_RESOURCE', 'REINDEX_ALL', 'MATCH_RESOURCE', 'BENCHMARK');
CREATE TYPE "AiJobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- 资源向量（embedding 列为 pgvector，Prisma 客户端不直接读写，走 $executeRaw/$queryRaw）
CREATE TABLE "ResourceEmbedding" (
    "id" TEXT NOT NULL,
    "targetType" "AiTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "embedding" vector(1024) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResourceEmbedding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ResourceEmbedding_targetType_targetId_key" ON "ResourceEmbedding"("targetType", "targetId");
CREATE INDEX "ResourceEmbedding_targetType_targetId_idx" ON "ResourceEmbedding"("targetType", "targetId");

-- AI 任务队列（PostgreSQL 轮询 + FOR UPDATE SKIP LOCKED 抢占）
CREATE TABLE "AiJob" (
    "id" TEXT NOT NULL,
    "type" "AiJobType" NOT NULL,
    "status" "AiJobStatus" NOT NULL DEFAULT 'PENDING',
    "targetType" "AiTargetType",
    "targetId" TEXT,
    "payload" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "workerId" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiJob_status_createdAt_idx" ON "AiJob"("status", "createdAt");
