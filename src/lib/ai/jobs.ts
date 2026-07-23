import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import type { AiTargetType } from "@prisma/client";
import { embedText } from "./embedding";
import { buildResourceText, contentHash } from "./normalize-resource";
import { getEmbeddingMeta, upsertEmbedding } from "./embedding-repo";

const MAX_ATTEMPTS = 3;
/** 本进程的 worker 标识（cron/脚本每次进程不同；benchmark 多 worker 时各自不同）。 */
const WORKER_ID = randomUUID();

/**
 * 入队 EMBED_RESOURCE（幂等：同资源已有 PENDING/RUNNING 则不重复入队）。
 * best-effort：内部捕获所有错误，绝不阻断发布流程。
 */
export async function enqueueEmbedResource(
  targetType: AiTargetType,
  targetId: string
): Promise<void> {
  try {
    const id = randomUUID();
    await prisma.$executeRaw`
      INSERT INTO "AiJob" ("id", "type", "status", "targetType", "targetId", "createdAt")
      SELECT ${id}, 'EMBED_RESOURCE'::"AiJobType", 'PENDING'::"AiJobStatus",
             ${targetType}::"AiTargetType", ${targetId}, now()
      WHERE NOT EXISTS (
        SELECT 1 FROM "AiJob"
        WHERE "targetType" = ${targetType}::"AiTargetType"
          AND "targetId" = ${targetId}
          AND "status" IN ('PENDING'::"AiJobStatus", 'RUNNING'::"AiJobStatus")
      )
    `;
  } catch {
    /* 入队失败不影响发布 */
  }
}

export interface ProcessResult {
  processed: number;
  succeeded: number;
  failed: number;
}

interface ClaimedJob {
  id: string;
  targetType: string;
  targetId: string;
  attempts: number;
}

/**
 * 抢占并处理至多 limit 个 PENDING EMBED_RESOURCE 任务。
 * 用 UPDATE ... FROM (SELECT ... FOR UPDATE SKIP LOCKED) 原子抢占，避免重复消费。
 */
export async function processPendingEmbeddingJobs(limit = 20): Promise<ProcessResult> {
  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  for (let i = 0; i < limit; i++) {
    const job = await claimOneEmbedJob();
    if (!job) break;
    processed++;
    const ok = await runEmbedJob(job).catch(() => false);
    if (ok) succeeded++;
    else failed++;
  }
  return { processed, succeeded, failed };
}

async function claimOneEmbedJob(): Promise<ClaimedJob | null> {
  const rows = await prisma.$queryRaw<ClaimedJob[]>`
    WITH claimed AS (
      SELECT "id" FROM "AiJob"
      WHERE "type" = 'EMBED_RESOURCE'::"AiJobType"
        AND "status" = 'PENDING'::"AiJobStatus"
      ORDER BY "createdAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "AiJob"
    SET "status" = 'RUNNING'::"AiJobStatus",
        "startedAt" = now(),
        "attempts" = "attempts" + 1,
        "workerId" = ${WORKER_ID}
    FROM claimed
    WHERE "AiJob"."id" = claimed."id"
    RETURNING "AiJob"."id", "AiJob"."targetType"::text AS "targetType",
              "AiJob"."targetId", "AiJob"."attempts"
  `;
  return rows[0] ?? null;
}

async function fetchResource(
  targetType: AiTargetType,
  targetId: string
): Promise<Record<string, unknown> | null> {
  if (targetType === "ITEM") {
    return prisma.item.findUnique({
      where: { id: targetId },
      select: {
        title: true,
        description: true,
        category: true,
        condition: true,
        priceMode: true,
        price: true,
        tags: true,
        tradeMethods: true,
        pickupLocation: true,
      },
    }) as Promise<Record<string, unknown> | null>;
  }
  if (targetType === "SERVICE") {
    return prisma.service.findUnique({
      where: { id: targetId },
      select: {
        title: true,
        description: true,
        qualification: true,
        categories: true,
        formats: true,
        durationTier: true,
        price: true,
      },
    }) as Promise<Record<string, unknown> | null>;
  }
  return prisma.need.findUnique({
    where: { id: targetId },
    select: {
      title: true,
      description: true,
      expectedProfile: true,
      reward: true,
      expectedTime: true,
      formatPreference: true,
      category: true,
    },
  }) as Promise<Record<string, unknown> | null>;
}

async function runEmbedJob(job: ClaimedJob): Promise<boolean> {
  const targetType = job.targetType as AiTargetType;
  try {
    const row = await fetchResource(targetType, job.targetId);
    if (!row) {
      await markFailed(job.id, "resource not found (deleted?)");
      return false;
    }
    const text = buildResourceText(targetType, row);
    const hash = contentHash(text);

    // 内容未变化 → 跳过重新生成（重复执行不产生重复向量）。
    const meta = await getEmbeddingMeta(targetType, job.targetId);
    if (meta?.contentHash === hash) {
      await markSucceeded(job.id);
      return true;
    }

    const { vector, model } = await embedText(text);
    await upsertEmbedding({ targetType, targetId: job.targetId, contentHash: hash, model, vector });
    await markSucceeded(job.id);
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (job.attempts >= MAX_ATTEMPTS) {
      await markFailed(job.id, msg);
    } else {
      await requeue(job.id, msg);
    }
    return false;
  }
}

async function markSucceeded(jobId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "AiJob" SET "status" = 'SUCCEEDED'::"AiJobStatus", "finishedAt" = now(), "error" = NULL
    WHERE "id" = ${jobId}
  `;
}

async function markFailed(jobId: string, error: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "AiJob" SET "status" = 'FAILED'::"AiJobStatus", "finishedAt" = now(), "error" = ${error}
    WHERE "id" = ${jobId}
  `;
}

/** 重试：回到 PENDING，记录最近错误（下一轮被再抢占，attempts 已累加）。 */
async function requeue(jobId: string, error: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "AiJob" SET "status" = 'PENDING'::"AiJobStatus", "error" = ${error}
    WHERE "id" = ${jobId}
  `;
}
