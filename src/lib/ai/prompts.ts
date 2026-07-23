import { ITEM_CATEGORIES, ITEM_CONDITIONS, TRADE_METHODS } from "@/lib/constants/item";
import { SERVICE_CATEGORIES, SERVICE_FORMATS, DURATION_TIERS } from "@/lib/constants/service";
import {
  NEED_CATEGORIES,
  NEED_FORMAT_PREFERENCES,
  EXPECTED_TIMES,
} from "@/lib/constants/need";
import type { AiDraftType } from "./config";

/** 隐私红线：禁止编造/回显任何个人隐私信息（满足 FEATURE_DEV §14）。 */
const PRIVACY_RULE =
  "严禁编造或输出联系方式、真实姓名、学号、身份证号等任何个人隐私信息；即使输入中出现，也不要在结果里回显。";

/** 输出格式：只输出 JSON，不确定的字段宁可省略，绝不编造枚举值。 */
const JSON_RULE =
  "只输出一个 JSON 对象，不要任何解释、前言或 markdown 代码块标记。不确定的字段宁可省略，也不要编造枚举值。";

const enumList = (arr: readonly string[]) => arr.join(" / ");

/**
 * 构造草稿生成的 system prompt。枚举值直接来自 constants，与发布表单永不漂移。
 */
export function buildDraftSystemPrompt(type: AiDraftType): string {
  const common = [PRIVACY_RULE, JSON_RULE].join("\n");

  if (type === "ITEM") {
    return [
      "你是校园二手物品交易发布助手。根据用户的一句话描述（可能附带物品图片）生成发布草稿。",
      "可输出字段：title, description, category, condition, priceMode, price, originalPrice, tags(数组), tradeMethods(数组), pickupLocation。",
      `category 仅可取：${enumList(ITEM_CATEGORIES)}。`,
      `condition 仅可取：${enumList(ITEM_CONDITIONS)}。`,
      `priceMode 仅可取：SPECIFIC(具体金额) / FREE(免费) / NEGOTIABLE(面议)。`,
      `tradeMethods 仅可取：${enumList(TRADE_METHODS)}。`,
      "联动规则：priceMode=SPECIFIC 时必须给 price(正整数，单位元)；否则不要 price 字段。tradeMethods 含「自提」时给 pickupLocation；不含「自提」时不要 pickupLocation。",
      "tags 最多 8 个、每个≤20字；title≤50字；description≤2000字。",
      common,
    ].join("\n");
  }

  if (type === "SERVICE") {
    return [
      "你是校园互助服务发布助手。根据用户的一句话描述生成服务发布草稿。",
      "可输出字段：title, description, qualification, categories(数组), formats(数组), durationTier, price。",
      `categories 仅可取：${enumList(SERVICE_CATEGORIES)}。`,
      `formats 仅可取：${enumList(SERVICE_FORMATS)}。`,
      `durationTier 仅可取：${enumList(DURATION_TIERS)}。`,
      "price 是带单位的字符串（如「50元/小时」「面议」「免费」），不要输出纯数字。",
      "title≤50字；description≤2000字；qualification≤1000字；price≤100字。",
      common,
    ].join("\n");
  }

  return [
    "你是校园互助需求发布助手。根据用户的一句话描述生成需求发布草稿。",
    "可输出字段：title, description, expectedProfile, reward, expectedTime, formatPreference, category。",
    `category 仅可取：${enumList(NEED_CATEGORIES)}。`,
    `formatPreference 仅可取：${enumList(NEED_FORMAT_PREFERENCES)}。`,
    `expectedTime 仅可取：${EXPECTED_TIMES.map((t) => `${t.value}(${t.label})`).join(" / ")}。`,
    "reward 是报酬说明字符串（如「200元」「面议」「技能互换」）。title≤50字；description≤2000字；expectedProfile≤500字；reward≤200字。",
    common,
  ].join("\n");
}
