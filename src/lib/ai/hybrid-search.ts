import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { expandSearchTerms } from "@/lib/search";
import { aggregateRatings, ratingNumber } from "@/lib/reputation";
import { embedText } from "./embedding";
import { cosineSearch } from "./embedding-repo";
import { computeFinalScore, freshnessScore, clamp01, paginate } from "./search-types";
import type { AiTargetType } from "@prisma/client";

/** 关键词得分：标题命中=2，描述命中=1，按 (词数*2) 归一化到 [0,1]。 */
function buildKeywordScore(
  rows: Array<{ id: string; title: string | null; description: string | null }>,
  terms: string[]
): Map<string, number> {
  const m = new Map<string, number>();
  if (terms.length === 0) return m;
  const denom = Math.max(1, terms.length * 2);
  const lower = terms.map((t) => t.toLowerCase());
  for (const r of rows) {
    let s = 0;
    const title = (r.title ?? "").toLowerCase();
    const desc = (r.description ?? "").toLowerCase();
    for (const t of lower) {
      if (title.includes(t)) s += 2;
      else if (desc.includes(t)) s += 1;
    }
    m.set(r.id, s / denom);
  }
  return m;
}

/** 语义召回；embedding/向量服务异常时返回空 map（降级为纯关键词），不抛出。 */
async function semanticScores(
  targetType: AiTargetType,
  query: string,
  k: number
): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  try {
    const { vector } = await embedText(query);
    const hits = await cosineSearch(targetType, vector, k);
    for (const h of hits) m.set(h.targetId, clamp01(h.score));
  } catch {
    /* 语义失败 → 仅关键词 */
  }
  return m;
}

// ────────────────────────────────────────────────────────────────
// 物品
// ────────────────────────────────────────────────────────────────

export interface HybridItemResult {
  items: Array<Prisma.ItemGetPayload<{ include: { seller: { select: { nickname: true } } } }>>;
  total: number;
  page: number;
  totalPages: number;
}

export async function hybridSearchItems(f: {
  status: string[];
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  search: string;
  page: number;
  pageSize: number;
}): Promise<HybridItemResult> {
  const terms = expandSearchTerms(f.search);

  const hard: Prisma.ItemWhereInput = {
    status: { in: f.status as never },
    deletedAt: null,
    ...(f.category ? { category: f.category } : {}),
  };
  const andClauses: Prisma.ItemWhereInput[] = [];
  if (f.minPrice != null || f.maxPrice != null) {
    andClauses.push({
      OR: [
        {
          priceMode: "SPECIFIC",
          price: {
            ...(f.minPrice != null ? { gte: f.minPrice } : {}),
            ...(f.maxPrice != null ? { lte: f.maxPrice } : {}),
          },
        },
        ...(f.minPrice == null || f.minPrice <= 0
          ? [{ priceMode: { in: ["FREE", "NEGOTIABLE"] as never } }]
          : []),
      ],
    });
  }

  const kwRows =
    terms.length > 0
      ? await prisma.item.findMany({
          where: {
            ...hard,
            AND: andClauses.length ? andClauses : undefined,
            OR: terms.flatMap((t) => [
              { title: { contains: t, mode: "insensitive" as const } },
              { description: { contains: t, mode: "insensitive" as const } },
              { category: { contains: t, mode: "insensitive" as const } },
            ]),
          },
          take: 100,
          select: { id: true, title: true, description: true },
        })
      : [];
  const kwScore = buildKeywordScore(kwRows, terms);
  const semScore = await semanticScores("ITEM", f.search, 50);

  const candidateIds = new Set<string>([...kwScore.keys(), ...semScore.keys()]);
  if (candidateIds.size === 0) return { items: [], total: 0, page: 1, totalPages: 1 };

  const rows = await prisma.item.findMany({
    where: {
      ...hard,
      AND: andClauses.length ? andClauses : undefined,
      id: { in: [...candidateIds] },
    },
    include: { seller: { select: { nickname: true } } },
  });
  const ratings = await aggregateRatings(
    rows.map((r) => r.sellerId),
    "ITEM"
  );
  const now = new Date();
  const scored = rows
    .map((row) => ({
      row,
      score: computeFinalScore({
        semanticScore: semScore.get(row.id) ?? 0,
        keywordScore: kwScore.get(row.id) ?? 0,
        freshnessScore: freshnessScore(row.createdAt, now),
        reputationScore: clamp01((ratingNumber(ratings, row.sellerId) ?? 0) / 5),
      }),
    }))
    .sort((a, b) => b.score - a.score);

  const page = paginate(scored.map((s) => s.row), f.page, f.pageSize);
  return { items: page.items, total: page.total, page: page.page, totalPages: page.totalPages };
}

// ────────────────────────────────────────────────────────────────
// 服务（无价格筛选；status 一般 ACTIVE）
// ────────────────────────────────────────────────────────────────

export interface HybridServiceResult {
  items: Array<Prisma.ServiceGetPayload<{ include: { provider: { select: { nickname: true } } } }>>;
  total: number;
  page: number;
  totalPages: number;
}

export async function hybridSearchServices(f: {
  status: string[];
  category?: string;
  search: string;
  page: number;
  pageSize: number;
}): Promise<HybridServiceResult> {
  const terms = expandSearchTerms(f.search);
  const hard: Prisma.ServiceWhereInput = {
    status: { in: f.status as never },
    deletedAt: null,
    ...(f.category ? { categories: { has: f.category } } : {}),
  };

  const kwRows =
    terms.length > 0
      ? await prisma.service.findMany({
          where: {
            ...hard,
            OR: terms.flatMap((t) => [
              { title: { contains: t, mode: "insensitive" as const } },
              { description: { contains: t, mode: "insensitive" as const } },
              { qualification: { contains: t, mode: "insensitive" as const } },
            ]),
          },
          take: 100,
          select: { id: true, title: true, description: true },
        })
      : [];
  const kwScore = buildKeywordScore(kwRows, terms);
  const semScore = await semanticScores("SERVICE", f.search, 50);

  const candidateIds = new Set<string>([...kwScore.keys(), ...semScore.keys()]);
  if (candidateIds.size === 0) return { items: [], total: 0, page: 1, totalPages: 1 };

  const rows = await prisma.service.findMany({
    where: { ...hard, id: { in: [...candidateIds] } },
    include: { provider: { select: { nickname: true } } },
  });
  const ratings = await aggregateRatings(
    rows.map((r) => r.providerId),
    "BOOKING"
  );
  const now = new Date();
  const scored = rows
    .map((row) => ({
      row,
      score: computeFinalScore({
        semanticScore: semScore.get(row.id) ?? 0,
        keywordScore: kwScore.get(row.id) ?? 0,
        freshnessScore: freshnessScore(row.createdAt, now),
        reputationScore: clamp01((ratingNumber(ratings, row.providerId) ?? 0) / 5),
      }),
    }))
    .sort((a, b) => b.score - a.score);

  const page = paginate(scored.map((s) => s.row), f.page, f.pageSize);
  return { items: page.items, total: page.total, page: page.page, totalPages: page.totalPages };
}

// ────────────────────────────────────────────────────────────────
// 需求（无价格筛选；status 一般 OPEN）
// ────────────────────────────────────────────────────────────────

export interface HybridNeedResult {
  items: Array<
    Prisma.NeedGetPayload<{
      include: {
        requester: { select: { nickname: true } };
        _count: { select: { matches: { where: { status: { in: ["APPLIED", "MATCHED"] } } } } };
      };
    }>
  >;
  total: number;
  page: number;
  totalPages: number;
}

export async function hybridSearchNeeds(f: {
  status: string[];
  category?: string;
  expectedTime?: string;
  formatPreference?: string;
  search: string;
  page: number;
  pageSize: number;
}): Promise<HybridNeedResult> {
  const terms = expandSearchTerms(f.search);
  const hard: Prisma.NeedWhereInput = {
    status: { in: f.status as never },
    deletedAt: null,
    ...(f.category ? { category: f.category } : {}),
    ...(f.expectedTime ? { expectedTime: f.expectedTime as never } : {}),
    ...(f.formatPreference ? { formatPreference: f.formatPreference } : {}),
  };

  const kwRows =
    terms.length > 0
      ? await prisma.need.findMany({
          where: {
            ...hard,
            OR: terms.flatMap((t) => [
              { title: { contains: t, mode: "insensitive" as const } },
              { description: { contains: t, mode: "insensitive" as const } },
              { expectedProfile: { contains: t, mode: "insensitive" as const } },
            ]),
          },
          take: 100,
          select: { id: true, title: true, description: true },
        })
      : [];
  const kwScore = buildKeywordScore(kwRows, terms);
  const semScore = await semanticScores("NEED", f.search, 50);

  const candidateIds = new Set<string>([...kwScore.keys(), ...semScore.keys()]);
  if (candidateIds.size === 0) return { items: [], total: 0, page: 1, totalPages: 1 };

  const rows = await prisma.need.findMany({
    where: { ...hard, id: { in: [...candidateIds] } },
    include: {
      requester: { select: { nickname: true } },
      _count: { select: { matches: { where: { status: { in: ["APPLIED", "MATCHED"] } } } } },
    },
  });
  const ratings = await aggregateRatings(
    rows.map((r) => r.requesterId),
    "NEED_MATCH"
  );
  const now = new Date();
  const scored = rows
    .map((row) => ({
      row,
      score: computeFinalScore({
        semanticScore: semScore.get(row.id) ?? 0,
        keywordScore: kwScore.get(row.id) ?? 0,
        freshnessScore: freshnessScore(row.createdAt, now),
        reputationScore: clamp01((ratingNumber(ratings, row.requesterId) ?? 0) / 5),
      }),
    }))
    .sort((a, b) => b.score - a.score);

  const page = paginate(scored.map((s) => s.row), f.page, f.pageSize);
  return { items: page.items, total: page.total, page: page.page, totalPages: page.totalPages };
}
