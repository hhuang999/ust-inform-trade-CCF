import { z } from "zod";
import { ITEM_CATEGORIES, ITEM_CONDITIONS, TRADE_METHODS } from "@/lib/constants/item";
import { SERVICE_CATEGORIES, SERVICE_FORMATS, DURATION_TIERS } from "@/lib/constants/service";
import {
  NEED_CATEGORIES,
  NEED_FORMAT_PREFERENCES,
  EXPECTED_TIMES,
} from "@/lib/constants/need";
import type { AiDraftType } from "./config";

const priceModeEnum = z.enum(["SPECIFIC", "FREE", "NEGOTIABLE"]);
const expectedTimeValues = EXPECTED_TIMES.map((t) => t.value) as [
  "ASAP",
  "THIS_WEEK",
  "TWO_WEEKS",
  "FLEXIBLE",
];

/**
 * 每类资源 AI 输出的「逐字段」校验 schema。
 * 刻意不含 contactInfo / contactVisibility / 图片字段 —— 这些由用户掌控、属隐私，
 * 也不含服务端只读字段（status / sellerId 等）。
 * 每字段独立校验：模型可省略任意字段，凡提供的字段须类型/枚举合法。
 * 枚举直接复用 constants，与发布表单永不漂移。
 */
export const DRAFT_FIELD_SCHEMAS: Record<
  AiDraftType,
  Record<string, z.ZodTypeAny>
> = {
  ITEM: {
    title: z.string().trim().min(1).max(50),
    description: z.string().trim().min(1).max(2000),
    category: z.enum(ITEM_CATEGORIES),
    condition: z.enum(ITEM_CONDITIONS),
    priceMode: priceModeEnum,
    price: z.number().int().nonnegative().max(1_000_000),
    originalPrice: z.number().int().nonnegative().max(1_000_000),
    tags: z.array(z.string().trim().min(1).max(20)).max(8),
    tradeMethods: z.array(z.enum(TRADE_METHODS)).min(1),
    pickupLocation: z.string().trim().max(200),
  },
  SERVICE: {
    title: z.string().trim().min(1).max(50),
    description: z.string().trim().min(1).max(2000),
    qualification: z.string().trim().min(1).max(1000),
    categories: z.array(z.enum(SERVICE_CATEGORIES)).min(1),
    formats: z.array(z.enum(SERVICE_FORMATS)).min(1),
    durationTier: z.enum(DURATION_TIERS),
    price: z.string().trim().min(1).max(100),
  },
  NEED: {
    title: z.string().trim().min(1).max(50),
    description: z.string().trim().min(1).max(2000),
    expectedProfile: z.string().trim().max(500),
    reward: z.string().trim().min(1).max(200),
    expectedTime: z.enum(expectedTimeValues),
    formatPreference: z.enum(NEED_FORMAT_PREFERENCES),
    category: z.enum(NEED_CATEGORIES),
  },
};

/** 路由入参校验。 */
export const draftInputSchema = z.object({
  type: z.enum(["ITEM", "SERVICE", "NEED"]),
  text: z.string().trim().min(1, "请输入一句话描述").max(500),
  imageKeys: z.array(z.string().min(1)).max(3).optional(),
});

export type DraftInput = z.infer<typeof draftInputSchema>;
