/** 混合检索打分核心（纯函数，便于单测）。权重见 FEATURE_DEV §7.3。 */

export interface HybridScoreParts {
  semanticScore: number;
  keywordScore: number;
  freshnessScore: number;
  reputationScore: number;
}

export const SCORE_WEIGHTS = {
  semantic: 0.6,
  keyword: 0.25,
  freshness: 0.1,
  reputation: 0.05,
} as const;

export function computeFinalScore(p: HybridScoreParts): number {
  return (
    SCORE_WEIGHTS.semantic * p.semanticScore +
    SCORE_WEIGHTS.keyword * p.keywordScore +
    SCORE_WEIGHTS.freshness * p.freshnessScore +
    SCORE_WEIGHTS.reputation * p.reputationScore
  );
}

/** 新鲜度：90 天线性衰减（最新=1，90 天前=0）。 */
export function freshnessScore(createdAt: Date, now: Date = new Date()): number {
  const ageDays = (now.getTime() - createdAt.getTime()) / 86_400_000;
  if (!Number.isFinite(ageDays) || ageDays <= 0) return 1;
  return Math.max(0, 1 - ageDays / 90);
}

export function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

/** 对已排序数组分页，page 越界收敛到最后一页。 */
export function paginate<T>(
  scored: T[],
  page: number,
  pageSize: number
): { items: T[]; total: number; page: number; totalPages: number } {
  const total = scored.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const p = Math.min(Math.max(1, Math.floor(page)), totalPages);
  const start = (p - 1) * pageSize;
  return { items: scored.slice(start, start + pageSize), total, page: p, totalPages };
}
