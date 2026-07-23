import { describe, it, expect, vi, beforeAll } from "vitest";
import { pickValid, coerceItemDraft, generateDraft } from "./draft";

describe("pickValid", () => {
  it("保留合法字段、丢弃非法枚举与非法数组元素", () => {
    const { values, warnings } = pickValid("ITEM", {
      title: "27寸显示器",
      category: "不存在的分类",
      condition: "全新",
      priceMode: "NEGOTIABLE",
      tags: ["显示器", ""], // 空标签触发元素 min(1) 失败 → 整个 tags 丢弃
      tradeMethods: ["自提"],
    });
    expect(values.title).toBe("27寸显示器");
    expect(values.condition).toBe("全新");
    expect(values.priceMode).toBe("NEGOTIABLE");
    expect(values.tradeMethods).toEqual(["自提"]);
    expect(values.category).toBeUndefined();
    expect(values.tags).toBeUndefined();
    expect(warnings.length).toBeGreaterThanOrEqual(2);
  });

  it("非对象输入返回空集", () => {
    const { values } = pickValid("SERVICE", "not an object");
    expect(Object.keys(values)).toHaveLength(0);
  });
});

describe("coerceItemDraft", () => {
  it("SPECIFIC 缺 price → 改 NEGOTIABLE", () => {
    const { draft, warnings } = coerceItemDraft({ priceMode: "SPECIFIC" });
    expect(draft.priceMode).toBe("NEGOTIABLE");
    expect(warnings.join()).toContain("面议");
  });

  it("FREE 带 price/originalPrice → 删除", () => {
    const { draft } = coerceItemDraft({ priceMode: "FREE", price: 100, originalPrice: 200 });
    expect(draft.price).toBeUndefined();
    expect(draft.originalPrice).toBeUndefined();
  });

  it("自提 缺 pickupLocation → 填占位地点（保留自提）", () => {
    const { draft, warnings } = coerceItemDraft({ tradeMethods: ["自提"] });
    expect(draft.tradeMethods).toEqual(["自提"]);
    expect(typeof draft.pickupLocation).toBe("string");
    expect((draft.pickupLocation as string).length).toBeGreaterThan(0);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("含 pickupLocation 但无自提 → 删除地点", () => {
    const { draft } = coerceItemDraft({ tradeMethods: ["邮寄"], pickupLocation: "宿舍" });
    expect(draft.pickupLocation).toBeUndefined();
  });

  it("无 tradeMethods 却带地点 → 删除地点", () => {
    const { draft } = coerceItemDraft({ pickupLocation: "宿舍" });
    expect(draft.pickupLocation).toBeUndefined();
  });

  it("自提 + 地点 → 保持不变且无 warning", () => {
    const { draft, warnings } = coerceItemDraft({
      tradeMethods: ["自提"],
      pickupLocation: "宿舍区",
    });
    expect(draft.tradeMethods).toEqual(["自提"]);
    expect(draft.pickupLocation).toBe("宿舍区");
    expect(warnings).toHaveLength(0);
  });

  it("SPECIFIC + price → 保持不变", () => {
    const { draft, warnings } = coerceItemDraft({ priceMode: "SPECIFIC", price: 700 });
    expect(draft.priceMode).toBe("SPECIFIC");
    expect(draft.price).toBe(700);
    expect(warnings).toHaveLength(0);
  });
});

describe("generateDraft (离线桩 / 无 key)", () => {
  // 开启总开关；测试环境不加载 .env，AI_API_KEY/AI_CHAT_MODEL 未设 → 走确定性桩。
  beforeAll(() => {
    vi.stubEnv("AI_DRAFT_ENABLED", "true");
  });
  it("物品：返回 stub 草稿、model=stub、枚举合法", async () => {
    const res = await generateDraft({ type: "ITEM", text: "毕业出27寸显示器，700元，宿舍自提" });
    expect(res.model).toBe("stub");
    expect(res.draft).not.toBeNull();
    expect(res.draft?.category).toBe("数码电子");
    expect(res.draft?.priceMode).toBe("SPECIFIC");
    expect(res.draft?.price).toBe(700);
  });

  it("服务：price 为字符串", async () => {
    const res = await generateDraft({ type: "SERVICE", text: "帮忙改英文简历" });
    expect(res.draft?.categories).toEqual(["文书润色"]);
    expect(typeof res.draft?.price).toBe("string");
  });

  it("需求：expectedTime/formatPreference 合法", async () => {
    const res = await generateDraft({ type: "NEED", text: "急寻周末线下辅导高数" });
    expect(res.draft?.expectedTime).toBe("ASAP");
    expect(res.draft?.formatPreference).toBe("线下");
    expect(res.draft?.category).toBe("学业辅导");
  });
});
