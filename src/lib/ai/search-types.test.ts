import { describe, it, expect } from "vitest";
import {
  computeFinalScore,
  freshnessScore,
  clamp01,
  paginate,
  SCORE_WEIGHTS,
} from "./search-types";

describe("computeFinalScore", () => {
  it("应用 0.60/0.25/0.10/0.05 权重", () => {
    const s = computeFinalScore({
      semanticScore: 1,
      keywordScore: 0,
      freshnessScore: 0,
      reputationScore: 0,
    });
    expect(s).toBeCloseTo(SCORE_WEIGHTS.semantic, 5);
  });

  it("语义占主导：高语义+零关键词 应排在 低语义+高关键词 之前", () => {
    const a = computeFinalScore({ semanticScore: 0.9, keywordScore: 0, freshnessScore: 0.5, reputationScore: 0.5 });
    const b = computeFinalScore({ semanticScore: 0.2, keywordScore: 1, freshnessScore: 0.5, reputationScore: 0.5 });
    expect(a).toBeGreaterThan(b);
  });

  it("其它相等时 keywordScore 高者胜（精确型号在语义相近时被关键词拔高）", () => {
    const a = computeFinalScore({ semanticScore: 0.5, keywordScore: 1, freshnessScore: 0.5, reputationScore: 0.5 });
    const b = computeFinalScore({ semanticScore: 0.5, keywordScore: 0, freshnessScore: 0.5, reputationScore: 0.5 });
    expect(a).toBeGreaterThan(b);
  });

  it("其它相等时 semanticScore 高者胜", () => {
    const a = computeFinalScore({ semanticScore: 0.9, keywordScore: 0.2, freshnessScore: 0.5, reputationScore: 0.5 });
    const b = computeFinalScore({ semanticScore: 0.4, keywordScore: 0.2, freshnessScore: 0.5, reputationScore: 0.5 });
    expect(a).toBeGreaterThan(b);
  });
});

describe("freshnessScore", () => {
  it("最新=1，90天=0", () => {
    const now = new Date("2026-07-23T00:00:00Z");
    expect(freshnessScore(now, now)).toBe(1);
    const old = new Date(now.getTime() - 90 * 86_400_000);
    expect(freshnessScore(old, now)).toBe(0);
    const mid = new Date(now.getTime() - 45 * 86_400_000);
    expect(freshnessScore(mid, now)).toBeCloseTo(0.5, 1);
  });
});

describe("clamp01", () => {
  it("夹取到 [0,1]", () => {
    expect(clamp01(1.5)).toBe(1);
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(0.4)).toBe(0.4);
    expect(clamp01(Number.NaN)).toBe(0);
  });
});

describe("paginate", () => {
  it("page 越界收敛到最后一页", () => {
    const arr = Array.from({ length: 25 }, (_, i) => i);
    const r = paginate(arr, 99, 10);
    expect(r.page).toBe(3);
    expect(r.totalPages).toBe(3);
    expect(r.items).toEqual([20, 21, 22, 23, 24]);
  });
});
