import {
  getChatConfig,
  hasVision,
  isAiDraftEnabled,
  r2PublicBaseUrl,
  type AiDraftType,
} from "./config";
import { DRAFT_FIELD_SCHEMAS, draftInputSchema, type DraftInput } from "./schemas";
import { buildDraftSystemPrompt } from "./prompts";
import { generateJson, type ChatImage, type GenerateJsonOptions } from "./provider";

export { draftInputSchema };
export type { AiDraftType, DraftInput, ChatImage };

export interface DraftRequest {
  type: AiDraftType;
  text: string;
  imageKeys?: string[];
}

export interface DraftResponse {
  /** 该类型的合法字段子集；null 表示 AI 完全失败（前端降级提示手填）。 */
  draft: Record<string, unknown> | null;
  /** 被丢弃的非法字段 / 降级原因，前端可展示。 */
  warnings: string[];
  /** "stub" / 真实模型名 / "disabled"。 */
  model: string;
}

/** 图片加载器：把 imageKeys 转成 data URL。可注入以便单测（默认从 R2 公开桶读）。 */
export type ImageLoader = (keys: string[]) => Promise<ChatImage[]>;

/**
 * 逐字段校验：保留 raw 中合法字段，丢弃非法字段并记 warning。接受任意字段子集。
 */
export function pickValid(
  type: AiDraftType,
  raw: unknown
): { values: Record<string, unknown>; warnings: string[] } {
  const warnings: string[] = [];
  const out: Record<string, unknown> = {};
  if (!raw || typeof raw !== "object") return { values: out, warnings };
  const src = raw as Record<string, unknown>;
  for (const [key, schema] of Object.entries(DRAFT_FIELD_SCHEMAS[type])) {
    if (src[key] === undefined || src[key] === null) continue;
    const r = schema.safeParse(src[key]);
    if (r.success) {
      out[key] = r.data;
    } else {
      warnings.push(`字段「${key}」取值非法，已忽略`);
    }
  }
  return { values: out, warnings };
}

/**
 * 物品草稿联动矫正，使字段子集自洽（满足 itemCreateSchema 的 superRefine 耦合）：
 * - priceMode=SPECIFIC 但缺 price → 改 NEGOTIABLE；
 * - priceMode≠SPECIFIC 却带 price/originalPrice → 删除；
 * - tradeMethods 含「自提」但缺 pickupLocation → 填占位「（请补充自提地点）」；
 * - 含 pickupLocation 但 tradeMethods 不含「自提」→ 删除 pickupLocation。
 */
export function coerceItemDraft(values: Record<string, unknown>): {
  draft: Record<string, unknown>;
  warnings: string[];
} {
  const warnings: string[] = [];
  const v: Record<string, unknown> = { ...values };

  const priceMode = v.priceMode as "SPECIFIC" | "FREE" | "NEGOTIABLE" | undefined;
  if (priceMode === "SPECIFIC") {
    if (v.price === undefined || v.price === null) {
      v.priceMode = "NEGOTIABLE";
      warnings.push("具体金额需填写价格，已改为面议");
    }
  } else if (priceMode !== undefined && (v.price !== undefined || v.originalPrice !== undefined)) {
    delete v.price;
    delete v.originalPrice;
    warnings.push("非具体金额不应带价格，已移除");
  }

  const tm = Array.isArray(v.tradeMethods) ? (v.tradeMethods as string[]) : undefined;
  const hasLocation =
    typeof v.pickupLocation === "string" && (v.pickupLocation as string).trim().length > 0;

  if (tm) {
    const hasSelfPickup = tm.includes("自提");
    if (hasSelfPickup && !hasLocation) {
      v.pickupLocation = "（请补充自提地点）";
      warnings.push("交易方式含自提，已填占位地点，请补充");
    } else if (!hasSelfPickup && hasLocation) {
      delete v.pickupLocation;
      warnings.push("未选自提却带地点，已移除地点");
    }
  } else if (hasLocation) {
    delete v.pickupLocation;
    warnings.push("未选自提却带地点，已移除地点");
  }

  return { draft: v, warnings };
}

function coerceDraft(
  type: AiDraftType,
  values: Record<string, unknown>
): { draft: Record<string, unknown>; warnings: string[] } {
  if (type === "ITEM") return coerceItemDraft(values);
  return { draft: values, warnings: [] };
}

/** 按正则命中选第一个匹配的值，否则取 fallback。用于离线桩的规则化推断。 */
function pickByRegex(text: string, rules: [RegExp, string][], fallback: string): string {
  for (const [re, val] of rules) {
    if (re.test(text)) return val;
  }
  return fallback;
}

/**
 * 离线桩：无 key 时基于规则生成原始 JSON，随后走与真机相同的 pickValid/矫正管线。
 * 不追求智能，只追求"合法 + 合理"的可用草稿，便于无网络/无 key 时端到端可用与单测。
 */
function buildStubJson(type: AiDraftType, text: string): unknown {
  const t = text.trim();

  if (type === "ITEM") {
    const priceMatch = /(\d{2,6})\s*[元块￥]/.exec(t);
    const priceMode: "SPECIFIC" | "FREE" | "NEGOTIABLE" = /免费|白送|免费送/.test(t)
      ? "FREE"
      : priceMatch
        ? "SPECIFIC"
        : "NEGOTIABLE";
    const category = pickByRegex(
      t,
      [
        [/显示|电脑|主机|键盘|鼠标|手机|平板|耳机|音响|相机|电子|充电|数据线|路由|硬盘/, "数码电子"],
        [/书|教材|笔记|资料|试卷|课|典/, "书籍教材"],
        [/台灯|收纳|椅|桌|锅|壶|伞|枕|被|生活/, "生活用品"],
        [/衣|鞋|包|裤|裙|帽/, "服饰鞋包"],
        [/球|拍|跑|健身|瑜伽|运动/, "运动健身"],
        [/琴|吉他|鼓|乐器/, "乐器"],
      ],
      "其他"
    );
    const tradeMethods = /自提/.test(t)
      ? ["自提"]
      : /邮|快递/.test(t)
        ? ["邮寄"]
        : /送/.test(t)
          ? ["送货"]
          : ["邮寄"];
    return {
      title: t.slice(0, 20) || "闲置物品",
      description: t,
      category,
      condition: "轻微使用痕迹",
      priceMode,
      ...(priceMode === "SPECIFIC" && priceMatch ? { price: Number(priceMatch[1]) } : {}),
      tags: [] as string[],
      tradeMethods,
    };
  }

  if (type === "SERVICE") {
    const category = pickByRegex(
      t,
      [
        [/简历|文书|论文|ps|personal statement|润色/, "文书润色"],
        [/辅导|教学|讲课|培训|补习/, "学业辅导"],
        [/翻译|translate/, "翻译"],
        [/设计|海报|ppt|排版|修图/, "设计"],
        [/代码|编程|开发|bug|技术|装机/, "技术支持"],
        [/咨询|规划|申请/, "咨询规划"],
      ],
      "其他"
    );
    const price = /免费|义务/.test(t) ? "免费" : "面议";
    return {
      title: t.slice(0, 20) || "互助服务",
      description: t,
      qualification: "请补充你的相关资质或经验",
      categories: [category],
      formats: /线下/.test(t) ? ["线下"] : ["线上"],
      price,
    };
  }

  const expectedTime = /尽快|急|马上|加急/.test(t)
    ? "ASAP"
    : /本周|这周/.test(t)
      ? "THIS_WEEK"
      : /两周|半个月/.test(t)
        ? "TWO_WEEKS"
        : "FLEXIBLE";
  const category = pickByRegex(
    t,
    [
      [/简历|文书|论文|润色/, "文书润色"],
      [/辅导|教学|讲课|补习/, "学业辅导"],
      [/翻译/, "翻译"],
      [/设计|海报|ppt/, "设计"],
      [/代码|编程|开发|技术/, "技术支持"],
    ],
    "其他"
  );
  return {
    title: t.slice(0, 20) || "互助需求",
    description: t,
    expectedProfile: "",
    reward: /免费|义务|互换|技能交换/.test(t) ? "技能互换" : "面议",
    expectedTime,
    formatPreference: /线上/.test(t) ? "线上" : /线下/.test(t) ? "线下" : "都可以",
    category,
  };
}

/** 默认图片加载器：从 R2 公开桶读前 3 张图，转 data URL；任一失败则跳过该张。 */
const defaultImageLoader: ImageLoader = async (keys) => {
  const base = r2PublicBaseUrl();
  if (!base) return [];
  const imgs: ChatImage[] = [];
  for (const key of keys.slice(0, 3)) {
    try {
      const res = await fetch(`${base}/${key}`, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) continue;
      const buf = await res.arrayBuffer();
      const ct = res.headers.get("content-type") || "image/jpeg";
      const b64 = Buffer.from(buf).toString("base64");
      imgs.push({ dataUrl: `data:${ct};base64,${b64}` });
    } catch {
      /* 单张失败静默跳过，整体退化为纯文本 */
    }
  }
  return imgs;
};

/**
 * 草稿生成编排：
 * 开关关 → {draft:null}；无 key → 离线桩；有 key → 真机（物品+视觉时读图）。
 * 真机失败 → {draft:null, warnings}，绝不向上抛出（发布流程不受影响）。
 */
export async function generateDraft(
  req: DraftRequest,
  opts: { loadImages?: ImageLoader } = {}
): Promise<DraftResponse> {
  if (!isAiDraftEnabled()) {
    return { draft: null, warnings: ["AI 草稿功能未开启"], model: "disabled" };
  }

  const cfg = getChatConfig();
  let raw: unknown;
  let model: string;

  if (!cfg) {
    raw = buildStubJson(req.type, req.text);
    model = "stub";
  } else {
    try {
      const system = buildDraftSystemPrompt(req.type);
      const genOpts: GenerateJsonOptions = {};
      if (req.type === "ITEM" && hasVision() && req.imageKeys && req.imageKeys.length > 0) {
        const loader = opts.loadImages ?? defaultImageLoader;
        const images = await loader(req.imageKeys);
        if (images.length > 0) genOpts.images = images;
      }
      const got = await generateJson(cfg, system, req.text, genOpts);
      raw = got.json;
      model = got.model;
    } catch (e) {
      return {
        draft: null,
        warnings: [`AI 暂不可用：${e instanceof Error ? e.message : "未知错误"}，请手动填写`],
        model: cfg.model,
      };
    }
  }

  const { values, warnings } = pickValid(req.type, raw);
  const { draft, warnings: coerceWarns } = coerceDraft(req.type, values);
  return { draft, warnings: [...warnings, ...coerceWarns], model };
}
