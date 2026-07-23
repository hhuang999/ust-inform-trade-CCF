import { describe, it, expect } from "vitest";
import { buildReasons } from "./matching-reasons";

describe("buildReasons（只来自规则模板，≤3 条）", () => {
  it("Need→Item：高分 + 预算匹配 + 线下 → 至多三条", () => {
    const r = buildReasons(
      { reward: "500元", formatPreference: "线下" },
      { price: 400, priceMode: "SPECIFIC", tradeMethods: ["自提"] },
      "NEED",
      "ITEM",
      0.7
    );
    expect(r).toContain("内容语义高度相关");
    expect(r).toContain("预算与商品价格匹配");
    expect(r).toContain("均支持线下交易");
    expect(r.length).toBeLessThanOrEqual(3);
  });

  it("低分且无预算/线下 → 不产生任何理由", () => {
    const r = buildReasons(
      { reward: "面议", formatPreference: "线上" },
      { price: 999, priceMode: "SPECIFIC", tradeMethods: ["邮寄"] },
      "NEED",
      "ITEM",
      0.2
    );
    expect(r).toEqual([]);
  });

  it("Need→Item：FREE 物品记为符合预算", () => {
    const r = buildReasons(
      { reward: "面议", formatPreference: "线下" },
      { priceMode: "FREE", tradeMethods: ["自提"] },
      "NEED",
      "ITEM",
      0.3
    );
    expect(r).toContain("对方免费赠送，符合预算");
  });

  it("Need→Service：高分 + 线下", () => {
    const r = buildReasons(
      { formatPreference: "都可以" },
      { formats: ["线下"] },
      "NEED",
      "SERVICE",
      0.6
    );
    expect(r).toContain("内容语义高度相关");
    expect(r).toContain("均支持线下交易");
  });

  it("Item→Need：只有语义理由（无价格/线下规则适用）", () => {
    const r = buildReasons(
      { tradeMethods: ["自提"], price: 100, priceMode: "SPECIFIC" },
      { reward: "200元", formatPreference: "线下" },
      "ITEM",
      "NEED",
      0.8
    );
    expect(r).toEqual(["内容语义高度相关"]);
  });

  it("理由仅来自允许的模板集合（不编造）", () => {
    const allowed = [
      "内容语义高度相关",
      "预算与商品价格匹配",
      "对方免费赠送，符合预算",
      "均支持线下交易",
    ];
    const r = buildReasons(
      { reward: "500元", formatPreference: "线下" },
      { price: 400, priceMode: "SPECIFIC", tradeMethods: ["自提"] },
      "NEED",
      "ITEM",
      0.7
    );
    for (const x of r) expect(allowed).toContain(x);
  });
});
