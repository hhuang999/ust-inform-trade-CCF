import { describe, it, expect } from "vitest";
import { buildResourceText, contentHash } from "./normalize-resource";

describe("buildResourceText（隐私 + 稳定）", () => {
  it("物品文本不含联系方式/可见性/真实姓名", () => {
    const text = buildResourceText("ITEM", {
      title: "27寸显示器",
      description: "毕业出",
      category: "数码电子",
      condition: "几乎全新",
      priceMode: "SPECIFIC",
      price: 700,
      tags: ["显示器"],
      tradeMethods: ["自提"],
      pickupLocation: "宿舍",
      contactInfo: "微信:SECRET_PHONE_13800000000",
      contactVisibility: "VERIFIED_ONLY",
      realName: "张三",
      studentId: "20240001",
    });
    expect(text).not.toContain("SECRET_PHONE");
    expect(text).not.toContain("13800000000");
    expect(text).not.toContain("VERIFIED_ONLY");
    expect(text).not.toContain("张三");
    expect(text).not.toContain("20240001");
    expect(text).toContain("数码电子");
    expect(text).toContain("700");
  });

  it("服务文本不含联系方式", () => {
    const text = buildResourceText("SERVICE", {
      title: "简历修改",
      description: "英文简历",
      categories: ["文书润色"],
      formats: ["线上"],
      durationTier: "1小时",
      price: "50元/份",
      qualification: "英语专业",
      contactInfo: "tel:13900000000",
    });
    expect(text).not.toContain("13900000000");
    expect(text).toContain("文书润色");
  });

  it("需求文本不含联系方式", () => {
    const text = buildResourceText("NEED", {
      title: "求辅导",
      description: "线性代数",
      reward: "200元",
      expectedTime: "ASAP",
      formatPreference: "线下",
      category: "学业辅导",
      contactInfo: "qq:secret",
    });
    expect(text).not.toContain("secret");
    expect(text).toContain("学业辅导");
  });
});

describe("contentHash", () => {
  it("相同文本同哈希、不同文本不同哈希", () => {
    expect(contentHash("abc")).toBe(contentHash("abc"));
    expect(contentHash("abc")).not.toBe(contentHash("abd"));
  });
});
