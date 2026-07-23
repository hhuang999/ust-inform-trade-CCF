import { prisma } from "@/lib/db";
import type { AiTargetType } from "@prisma/client";
import { embedText } from "./embedding";
import { cosineSearch } from "./embedding-repo";
import { buildResourceText } from "./normalize-resource";
import { buildReasons } from "./matching-reasons";

export { buildReasons };

const MATCH_K = 10;
const HIGH_SCORE_THRESHOLD = 0.6;

/** 跨业务撮合方向：Need → Item/Service；Item/Service → Need。 */
function candidateTypes(sourceType: AiTargetType): AiTargetType[] {
  if (sourceType === "NEED") return ["ITEM", "SERVICE"];
  return ["NEED"];
}

function ownerIdOf(type: AiTargetType, row: Record<string, unknown>): string | undefined {
  if (type === "ITEM") return row.sellerId as string | undefined;
  if (type === "SERVICE") return row.providerId as string | undefined;
  return row.requesterId as string | undefined;
}

async function fetchSource(
  type: AiTargetType,
  id: string
): Promise<Record<string, unknown> | null> {
  if (type === "ITEM") {
    return prisma.item.findUnique({
      where: { id },
      select: { id: true, sellerId: true, title: true, description: true, category: true, condition: true, priceMode: true, price: true, tags: true, tradeMethods: true, pickupLocation: true, status: true, deletedAt: true },
    }) as Promise<Record<string, unknown> | null>;
  }
  if (type === "SERVICE") {
    return prisma.service.findUnique({
      where: { id },
      select: { id: true, providerId: true, title: true, description: true, qualification: true, categories: true, formats: true, durationTier: true, price: true, status: true, deletedAt: true },
    }) as Promise<Record<string, unknown> | null>;
  }
  return prisma.need.findUnique({
    where: { id },
    select: { id: true, requesterId: true, title: true, description: true, expectedProfile: true, reward: true, expectedTime: true, formatPreference: true, category: true, status: true, deletedAt: true },
  }) as Promise<Record<string, unknown> | null>;
}

async function fetchTargets(
  type: AiTargetType,
  ids: string[]
): Promise<Array<Record<string, unknown> & { id: string }>> {
  if (ids.length === 0) return [];
  const status = type === "ITEM" ? ["AVAILABLE", "PENDING"] : type === "SERVICE" ? ["ACTIVE"] : ["OPEN"];
  if (type === "ITEM") {
    const rows = await prisma.item.findMany({
      where: { id: { in: ids }, deletedAt: null, status: { in: status as never } },
      select: { id: true, sellerId: true, title: true, description: true, category: true, condition: true, priceMode: true, price: true, tags: true, tradeMethods: true, pickupLocation: true, status: true },
    });
    return rows as Array<Record<string, unknown> & { id: string }>;
  }
  if (type === "SERVICE") {
    const rows = await prisma.service.findMany({
      where: { id: { in: ids }, deletedAt: null, status: { in: status as never } },
      select: { id: true, providerId: true, title: true, description: true, categories: true, formats: true, durationTier: true, price: true, status: true },
    });
    return rows as Array<Record<string, unknown> & { id: string }>;
  }
  const rows = await prisma.need.findMany({
    where: { id: { in: ids }, deletedAt: null, status: { in: status as never } },
    select: { id: true, requesterId: true, title: true, description: true, reward: true, expectedTime: true, formatPreference: true, category: true, status: true },
  });
  return rows as Array<Record<string, unknown> & { id: string }>;
}

/**
 * 为某资源生成跨业务推荐（写 AiRecommendation）。
 * - 用源资源向量在候选类型上做 cosine 召回；
 * - 仅保留有效状态、非本人资源、且至少有 1 条规则理由的候选；
 * - 首次出现高分推荐时给源资源所有者发一条站内通知。
 * best-effort，内部捕获错误，不抛出。
 */
export async function generateMatchesFor(
  sourceType: AiTargetType,
  sourceId: string
): Promise<void> {
  try {
    const source = await fetchSource(sourceType, sourceId);
    if (!source || source.deletedAt) return;
    const sourceOwner = ownerIdOf(sourceType, source);

    let sourceVec: number[];
    try {
      sourceVec = (await embedText(buildResourceText(sourceType, source))).vector;
    } catch {
      return;
    }

    const hadHighScoreBefore =
      sourceOwner != null
        ? await prisma.aiRecommendation.findFirst({
            where: { sourceType, sourceId, score: { gte: HIGH_SCORE_THRESHOLD } },
            select: { id: true },
          })
        : null;

    let producedHighScore = false;

    for (const targetType of candidateTypes(sourceType)) {
      const hits = await cosineSearch(targetType, sourceVec, MATCH_K);
      if (hits.length === 0) continue;
      const scoreMap = new Map(hits.map((h) => [h.targetId, h.score]));
      const rows = await fetchTargets(targetType, hits.map((h) => h.targetId));
      for (const row of rows) {
        const targetOwner = ownerIdOf(targetType, row);
        if (sourceOwner && targetOwner && sourceOwner === targetOwner) continue; // 不推荐自己的资源给自己
        const score = scoreMap.get(row.id) ?? 0;
        const reasons = buildReasons(source, row, sourceType, targetType, score);
        if (reasons.length === 0) continue;
        if (score >= HIGH_SCORE_THRESHOLD) producedHighScore = true;

        await prisma.aiRecommendation.upsert({
          where: {
            sourceType_sourceId_targetType_targetId: { sourceType, sourceId, targetType, targetId: row.id },
          },
          update: { score, reasons, model: "bge-m3+rules" },
          create: { sourceType, sourceId, targetType, targetId: row.id, score, reasons, model: "bge-m3+rules" },
        });
      }
    }

    // 首次高分推荐 → 一条站内通知（幂等：此前已有高分记录则不重复发）。
    if (producedHighScore && !hadHighScoreBefore && sourceOwner) {
      await prisma.notification.create({
        data: {
          userId: sourceOwner,
          type: "ai_recommendation",
          title: "AI 为你找到可能的匹配",
          body: "系统根据你新发布的内容，找到了一些可能相关的资源，点击查看。",
          link: `/${sourceType === "ITEM" ? "items" : sourceType === "SERVICE" ? "services" : "needs"}/${sourceId}`,
          data: { sourceType, sourceId } as never,
        },
      });
    }
  } catch {
    /* 撮合失败不影响主流程 */
  }
}

export interface EnrichedRecommendation {
  targetType: AiTargetType;
  targetId: string;
  score: number;
  reasons: string[];
  title: string;
  href: string;
}

/** 读取某资源的推荐（已附带标题/链接，供详情页卡片渲染）。 */
export async function getEnrichedRecommendations(
  sourceType: AiTargetType,
  sourceId: string,
  limit = 3
): Promise<EnrichedRecommendation[]> {
  const recs = await prisma.aiRecommendation.findMany({
    where: { sourceType, sourceId },
    orderBy: { score: "desc" },
    take: limit,
  });
  if (recs.length === 0) return [];

  // 按 targetType 分组取标题
  const byType = new Map<AiTargetType, string[]>();
  for (const r of recs) {
    const arr = byType.get(r.targetType) ?? [];
    arr.push(r.targetId);
    byType.set(r.targetType, arr);
  }
  const titleMap = new Map<string, string>();
  for (const [t, ids] of byType) {
    const rows = await fetchTargets(t, ids);
    for (const row of rows) titleMap.set(row.id, (row.title as string) ?? "未命名");
  }

  const prefix = (t: AiTargetType) => (t === "ITEM" ? "/items" : t === "SERVICE" ? "/services" : "/needs");
  return recs
    .filter((r) => titleMap.has(r.targetId))
    .map((r) => ({
      targetType: r.targetType,
      targetId: r.targetId,
      score: r.score,
      reasons: r.reasons,
      title: titleMap.get(r.targetId) ?? "未命名",
      href: `${prefix(r.targetType)}/${r.targetId}`,
    }));
}
