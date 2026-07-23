import { createHash } from "node:crypto";
import type { AiTargetType } from "@prisma/client";

/**
 * 把三类资源规范化为稳定文本（供 embedding）。
 * 隐私红线：刻意不含 contactInfo / contactVisibility / realName / studentId / 任何 id。
 * 字段名=字段值 格式，便于向量捕获结构语义。
 */
function val(r: Record<string, unknown>, k: string): string {
  const v = r[k];
  if (v === undefined || v === null) return "";
  if (Array.isArray(v)) return v.filter((x) => x !== null && x !== undefined).join("/");
  return String(v);
}

export function buildResourceText(targetType: AiTargetType, r: Record<string, unknown>): string {
  if (targetType === "ITEM") {
    return [
      "类型=物品",
      `标题=${val(r, "title")}`,
      `分类=${val(r, "category")}`,
      `成色=${val(r, "condition")}`,
      `描述=${val(r, "description")}`,
      `标签=${val(r, "tags")}`,
      `价格=${val(r, "priceMode")}:${val(r, "price")}`,
      `交易方式=${val(r, "tradeMethods")}`,
      `地点=${val(r, "pickupLocation")}`,
    ].join("\n");
  }
  if (targetType === "SERVICE") {
    return [
      "类型=服务",
      `标题=${val(r, "title")}`,
      `分类=${val(r, "categories")}`,
      `形式=${val(r, "formats")}`,
      `时长=${val(r, "durationTier")}`,
      `价格=${val(r, "price")}`,
      `资质=${val(r, "qualification")}`,
      `描述=${val(r, "description")}`,
    ].join("\n");
  }
  return [
    "类型=需求",
    `标题=${val(r, "title")}`,
    `分类=${val(r, "category")}`,
    `报酬=${val(r, "reward")}`,
    `期望时间=${val(r, "expectedTime")}`,
    `形式偏好=${val(r, "formatPreference")}`,
    `期望画像=${val(r, "expectedProfile")}`,
    `描述=${val(r, "description")}`,
  ].join("\n");
}

/** 内容指纹：决定资源内容是否变化、是否需要重新生成向量（去重）。 */
export function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
