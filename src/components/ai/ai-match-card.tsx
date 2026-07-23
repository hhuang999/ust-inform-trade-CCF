import Link from "next/link";
import { Sparkles } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { isAiRecommendationEnabled } from "@/lib/ai/config";
import { getEnrichedRecommendations } from "@/lib/ai/matching";
import type { AiTargetType } from "@prisma/client";

const TYPE_LABEL: Record<AiTargetType, string> = {
  ITEM: "物品",
  SERVICE: "服务",
  NEED: "需求",
};

/**
 * "AI 为你匹配" 卡片（服务端组件）：读取某资源的跨业务推荐并渲染 1–3 条可解释候选。
 * 撮合开关关 / 无推荐 → 不渲染。点击进入对应详情页，后续走现有业务流程。
 */
export async function AiMatchCard({
  sourceType,
  sourceId,
}: {
  sourceType: AiTargetType;
  sourceId: string;
}) {
  if (!isAiRecommendationEnabled()) return null;
  const recs = await getEnrichedRecommendations(sourceType, sourceId, 3);
  if (recs.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-serif text-lg">
          <Sparkles className="size-4 text-primary" />
          AI 为你匹配
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {recs.map((r) => (
          <Link
            key={`${r.targetType}-${r.targetId}`}
            href={r.href}
            className="block rounded-lg border border-input bg-card p-3 transition-colors hover:bg-accent/50"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="line-clamp-1 font-medium">{r.title}</span>
              <Badge variant="outline" className="shrink-0">
                {TYPE_LABEL[r.targetType]}
              </Badge>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1">
              {r.reasons.map((rea) => (
                <span key={rea} className="text-xs text-muted-foreground">
                  · {rea}
                </span>
              ))}
            </div>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
