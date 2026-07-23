import type { AiTargetType } from "@prisma/client";

/** 从字符串里抽取第一个金额数字（"200元"/"预算800以内" → 200/800）。 */
export function parsePriceNumber(s: unknown): number | undefined {
  if (typeof s !== "string") return undefined;
  const m = /(\d{2,7})/.exec(s);
  return m ? Number(m[1]) : undefined;
}

/**
 * 规则模板（FEATURE_DEV §8.3）：只基于 DB 字段，最多 3 条，不编造。
 * - 内容语义高度相关（cosine 分数）
 * - 预算与商品价格匹配（Need reward ≥ Item price）/ 对方免费
 * - 均支持线下交易（format/tradeMethods/formats）
 * 纯函数，不依赖 DB，便于单测。
 */
export function buildReasons(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  sourceType: AiTargetType,
  targetType: AiTargetType,
  score: number
): string[] {
  const reasons: string[] = [];
  if (score >= 0.45) reasons.push("内容语义高度相关");

  if (sourceType === "NEED" && targetType === "ITEM") {
    const budget = parsePriceNumber(source.reward);
    const itemPrice = target.price as number | undefined;
    const itemMode = target.priceMode as string | undefined;
    if (itemMode === "FREE") {
      reasons.push("对方免费赠送，符合预算");
    } else if (budget != null && typeof itemPrice === "number" && itemPrice <= budget) {
      reasons.push("预算与商品价格匹配");
    }
    const fp = source.formatPreference as string | undefined;
    const tm = Array.isArray(target.tradeMethods) ? (target.tradeMethods as string[]) : [];
    if ((fp === "线下" || fp === "都可以") && (tm.includes("自提") || tm.includes("送货"))) {
      reasons.push("均支持线下交易");
    }
  }

  if (sourceType === "NEED" && targetType === "SERVICE") {
    const fp = source.formatPreference as string | undefined;
    const formats = Array.isArray(target.formats) ? (target.formats as string[]) : [];
    if ((fp === "线下" || fp === "都可以") && formats.includes("线下")) {
      reasons.push("均支持线下交易");
    }
  }

  return reasons.slice(0, 3);
}
