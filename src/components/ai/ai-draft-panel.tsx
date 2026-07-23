"use client";

import * as React from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/input";
import type { AiDraftType } from "@/lib/ai/config";

export interface AiDraftPanelProps {
  type: AiDraftType;
  /** 物品草稿读图用：已上传的 R2 key（最多取前 3 张）。仅 ITEM 传。 */
  imageKeys?: string[];
  /** 应用草稿：partial 为字段值，filledFields 为本次填入的字段名列表。 */
  onApply: (partial: Record<string, unknown>, filledFields: string[]) => void;
}

const FIELD_LABELS: Record<AiDraftType, Record<string, string>> = {
  ITEM: {
    title: "标题",
    description: "描述",
    category: "分类",
    condition: "成色",
    priceMode: "价格模式",
    price: "价格",
    originalPrice: "原价",
    tags: "标签",
    tradeMethods: "交易方式",
    pickupLocation: "自提地点",
  },
  SERVICE: {
    title: "标题",
    description: "描述",
    qualification: "资质",
    categories: "分类",
    formats: "形式",
    durationTier: "时长",
    price: "价格",
  },
  NEED: {
    title: "标题",
    description: "描述",
    expectedProfile: "期望画像",
    reward: "报酬",
    expectedTime: "期望时间",
    formatPreference: "形式偏好",
    category: "分类",
  },
};

const PLACEHOLDER: Record<AiDraftType, string> = {
  ITEM: "例如：毕业出 27 寸显示器，700 元左右，宿舍自提",
  SERVICE: "例如：周末帮忙修改英文简历，英语专业，线上",
  NEED: "例如：求一位能辅导线性代数的同学，本周内线下",
};

const DESCRIPTION: Record<AiDraftType, string> = {
  ITEM: "上传图片 + 一句话，AI 自动生成草稿，你可再修改后发布",
  SERVICE: "一句话描述你要提供的服务，AI 自动生成草稿",
  NEED: "一句话描述你的需求，AI 自动生成草稿",
};

interface ApiResponse {
  draft: Record<string, unknown> | null;
  warnings: string[];
  model: string;
}

/** 松散的 RHF setValue 签名，便于各表单以 `as never` 传入（与仓库现有 resolver `as never` 一致）。 */
export type LooseSetValue = (
  name: string,
  value: unknown,
  opts?: { shouldDirty?: boolean }
) => void;

/**
 * 把 AI 草稿逐字段回填到 RHF 表单，并标记 dirty（触发草稿自动保存等副作用）。
 */
export function applyDraftToForm(setValue: LooseSetValue, partial: Record<string, unknown>) {
  for (const [k, v] of Object.entries(partial)) {
    setValue(k, v, { shouldDirty: true });
  }
}

/**
 * AI 草稿面板：一句自然语言 → 调 /api/ai/draft → 回填表单。
 * AI 失败 / 未开启 / 网络错误 都只提示用户手填，绝不阻断发布。
 */
export function AiDraftPanel({ type, imageKeys, onApply }: AiDraftPanelProps) {
  const [text, setText] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [filled, setFilled] = React.useState<string[] | null>(null);
  const [warnText, setWarnText] = React.useState<string>("");

  async function run() {
    const t = text.trim();
    if (!t) {
      toast.error("请先输入一句话描述");
      return;
    }
    setLoading(true);
    setFilled(null);
    setWarnText("");
    try {
      const res = await fetch("/api/ai/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          text: t,
          imageKeys: imageKeys?.length ? imageKeys.slice(0, 3) : undefined,
        }),
      });
      if (res.status === 503) {
        toast.info("AI 草稿功能未开启，请手动填写");
        return;
      }
      if (res.status === 401) {
        toast.error("请先登录");
        return;
      }
      if (!res.ok) {
        toast.error("AI 请求失败，请手动填写");
        return;
      }
      const data = (await res.json()) as ApiResponse;
      if (!data.draft || Object.keys(data.draft).length === 0) {
        toast.error(data.warnings?.[0] ?? "AI 暂不可用，请手动填写");
        return;
      }
      const fields = Object.keys(data.draft);
      onApply(data.draft, fields);
      setFilled(fields);
      setWarnText((data.warnings ?? []).join("；"));
      toast.success("AI 已填入草稿，请核对后提交");
    } catch {
      toast.error("AI 请求失败，请手动填写");
    } finally {
      setLoading(false);
    }
  }

  const labels = FIELD_LABELS[type];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-serif text-lg">
          <Sparkles className="size-4 text-primary" />
          AI 帮我填写
        </CardTitle>
        <CardDescription>{DESCRIPTION[type]}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          rows={3}
          maxLength={500}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={PLACEHOLDER[type]}
          disabled={loading}
        />
        <Button
          type="button"
          variant="outline"
          onClick={run}
          disabled={loading || !text.trim()}
        >
          {loading ? (
            <>
              <Loader2 className="animate-spin" />
              生成中…
            </>
          ) : (
            <>
              <Sparkles />
              AI 帮我填写
            </>
          )}
        </Button>
        {filled && filled.length > 0 ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">AI 已填入：</span>
              {filled.map((f) => (
                <span
                  key={f}
                  className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary ring-1 ring-inset ring-primary/20"
                >
                  {labels[f] ?? f}
                </span>
              ))}
            </div>
            {warnText ? (
              <p className="text-xs text-muted-foreground">{warnText}</p>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
