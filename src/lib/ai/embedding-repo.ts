import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import type { AiTargetType } from "@prisma/client";

/**
 * ResourceEmbedding 的向量读写层。embedding 列是 pgvector，Prisma 客户端不直接读写，
 * 故写入与 cosine 查询都用参数化 $executeRaw / $queryRaw（向量以文本 [a,b,c] 形式传入再 ::vector 转换）。
 */

function toPgVector(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

export interface EmbeddingUpsert {
  targetType: AiTargetType;
  targetId: string;
  contentHash: string;
  model: string;
  vector: number[];
}

/** 写入/覆盖某资源的向量（按 targetType+targetId 唯一约束 upsert）。 */
export async function upsertEmbedding(p: EmbeddingUpsert): Promise<void> {
  const id = randomUUID();
  const vecStr = toPgVector(p.vector);
  await prisma.$executeRaw`
    INSERT INTO "ResourceEmbedding"
      ("id", "targetType", "targetId", "contentHash", "model", "embedding", "createdAt", "updatedAt")
    VALUES
      (${id}, ${p.targetType}::"AiTargetType", ${p.targetId}, ${p.contentHash}, ${p.model}, ${vecStr}::vector, now(), now())
    ON CONFLICT ("targetType", "targetId") DO UPDATE SET
      "contentHash" = EXCLUDED."contentHash",
      "model" = EXCLUDED."model",
      "embedding" = EXCLUDED."embedding",
      "updatedAt" = now()
  `;
}

/** 读取已存向量指纹，用于判断内容是否变化、是否需要重新生成。 */
export async function getEmbeddingMeta(
  targetType: AiTargetType,
  targetId: string
): Promise<{ contentHash: string } | null> {
  const row = await prisma.resourceEmbedding.findUnique({
    where: { targetType_targetId: { targetType, targetId } },
    select: { contentHash: true },
  });
  return row;
}

export interface CosineHit {
  targetId: string;
  score: number;
}

/**
 * 余弦相似度检索：1 - (embedding <=> query)。返回 score 降序候选（score∈[0,1]）。
 * 仅做向量召回；状态/权限/价格等硬过滤交由调用方（hybrid-search）在 TS 层完成。
 */
export async function cosineSearch(
  targetType: AiTargetType,
  queryVector: number[],
  limit: number,
  excludeTargetIds: string[] = []
): Promise<CosineHit[]> {
  const vecStr = toPgVector(queryVector);
  // 多取一些以补偿 exclude 过滤。
  const overscan = Math.min(limit + excludeTargetIds.length + 20, 200);
  const rows = await prisma.$queryRaw<{ targetId: string; score: unknown }[]>`
    SELECT "targetId", 1 - ("embedding" <=> ${vecStr}::vector) AS score
    FROM "ResourceEmbedding"
    WHERE "targetType" = ${targetType}::"AiTargetType"
    ORDER BY "embedding" <=> ${vecStr}::vector
    LIMIT ${overscan}
  `;
  const exclude = new Set(excludeTargetIds);
  return rows
    .filter((r) => !exclude.has(r.targetId))
    .slice(0, limit)
    .map((r) => ({ targetId: r.targetId, score: Number(r.score) }));
}
