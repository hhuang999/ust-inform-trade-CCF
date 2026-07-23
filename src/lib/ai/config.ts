/**
 * AI 功能共用配置（Step 1：草稿生成；Step 2-5 复用并扩展）。
 * 沿用仓库 process.env 风格（与 db.ts/r2.ts 一致），不引入额外 env 校验依赖。
 * 任何必需配置缺失都 fail-soft：调用方据此走离线桩或隐藏入口。
 */

export type AiDraftType = "ITEM" | "SERVICE" | "NEED";

/** 默认 OpenAI 兼容端点：SiliconFlow（已实测）。可用 AI_BASE_URL 覆盖切换供应商。 */
const DEFAULT_AI_BASE_URL = "https://api.siliconflow.cn/v1";

export interface AiChatConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/**
 * 读取聊天模型配置。仅当 AI_API_KEY 与 AI_CHAT_MODEL 都非空时返回；
 * 否则返回 null —— 调用方据此走离线桩（单测与降级路径）。
 */
export function getChatConfig(): AiChatConfig | null {
  const apiKey = process.env.AI_API_KEY?.trim();
  const model = process.env.AI_CHAT_MODEL?.trim();
  if (!apiKey || !model) return null;
  const baseUrl = (process.env.AI_BASE_URL?.trim() || DEFAULT_AI_BASE_URL).replace(
    /\/+$/,
    ""
  );
  return { baseUrl, apiKey, model };
}

/** 聊天模型是否支持视觉（物品草稿读图用）。默认 false。 */
export function hasVision(): boolean {
  return process.env.AI_CHAT_VISION === "true";
}

/** AI 草稿总开关。未设或非 "true" 时隐藏入口、路由返回 503。 */
export function isAiDraftEnabled(): boolean {
  return process.env.AI_DRAFT_ENABLED === "true";
}

/** R2 公开桶基址（服务端读物品图用），与 UI 侧 NEXT_PUBLIC_R2_PUBLIC_BASE_URL 同源。 */
export function r2PublicBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_R2_PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");
}

export interface AiEmbeddingConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  dim: number;
}

/**
 * 读取 embedding 配置。API key/base 缺省回退到聊天模型配置（同一供应商即可）；
 * 仅当 AI_EMBEDDING_MODEL 非空时返回。否则 null（worker 跳过、搜索回退关键词）。
 */
export function getEmbeddingConfig(): AiEmbeddingConfig | null {
  const apiKey = process.env.AI_EMBEDDING_API_KEY?.trim() || process.env.AI_API_KEY?.trim();
  const model = process.env.AI_EMBEDDING_MODEL?.trim();
  if (!apiKey || !model) return null;
  const baseUrl = (
    process.env.AI_EMBEDDING_BASE_URL?.trim() ||
    process.env.AI_BASE_URL?.trim() ||
    DEFAULT_AI_BASE_URL
  ).replace(/\/+$/, "");
  const dim = Number(process.env.AI_EMBEDDING_DIM ?? 1024) || 1024;
  return { baseUrl, apiKey, model, dim };
}

/** 语义搜索开关（Step 3）。 */
export function isAiSearchEnabled(): boolean {
  return process.env.AI_SEARCH_ENABLED === "true";
}

/** 智能撮合开关（Step 4）。 */
export function isAiRecommendationEnabled(): boolean {
  return process.env.AI_RECOMMENDATION_ENABLED === "true";
}
