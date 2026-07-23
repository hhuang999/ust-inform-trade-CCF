import Link from "next/link";
import { redirect } from "next/navigation";
import { Activity, Clock, Cpu, Gauge, ListChecks } from "lucide-react";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isAdmin } from "@/lib/permissions";
import { PageContainer } from "@/components/layout/page-container";
import { SectionHeading } from "@/components/site/section-heading";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/time";
import type { AiJobStatus } from "@prisma/client";

interface BenchPayload {
  size?: number;
  model?: string;
  results?: Record<string, { workers: number; seconds: number; throughput: number }>;
}

const STATUS_LABEL: Record<AiJobStatus, string> = {
  PENDING: "待处理",
  RUNNING: "运行中",
  SUCCEEDED: "成功",
  FAILED: "失败",
};

const STATUS_TONE: Record<AiJobStatus, string> = {
  PENDING: "bg-muted text-foreground",
  RUNNING: "bg-primary/15 text-primary",
  SUCCEEDED: "bg-emerald-500/15 text-emerald-600",
  FAILED: "bg-destructive/15 text-destructive",
};

export default async function AiBenchmarkPage() {
  const session = await auth();
  if (!isAdmin(session?.user ?? null)) redirect("/");

  const [byStatus, byType, benchmarks] = await Promise.all([
    prisma.aiJob.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.aiJob.groupBy({ by: ["type"], _count: { _all: true } }),
    prisma.aiJob.findMany({
      where: { type: "BENCHMARK", status: "SUCCEEDED" },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, createdAt: true, payload: true },
    }),
  ]);

  const statusCount = (s: AiJobStatus) =>
    byStatus.find((r) => r.status === s)?._count._all ?? 0;

  const latest = benchmarks[0];
  const latestPayload = (latest?.payload ?? null) as BenchPayload | null;
  const results = latestPayload?.results ?? {};
  const maxThroughput = Math.max(0, ...Object.values(results).map((r) => r.throughput ?? 0));

  return (
    <PageContainer className="space-y-6">
      <SectionHeading
        title="AI 批处理基准"
        description="Ray 分布式批处理的任务状态与多 Worker 性能对比"
      />

      {/* 任务状态 */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {(["PENDING", "RUNNING", "SUCCEEDED", "FAILED"] as AiJobStatus[]).map((s) => (
          <Card key={s}>
            <CardContent className="flex items-center gap-3 p-4">
              <span className={`flex size-10 items-center justify-center rounded-full text-sm font-semibold ${STATUS_TONE[s]}`}>
                {statusCount(s)}
              </span>
              <div>
                <div className="text-xs text-muted-foreground">任务</div>
                <div className="text-sm font-medium">{STATUS_LABEL[s]}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 最近基准：1/2/4 worker 对比 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-serif text-lg">
            <Gauge className="size-4 text-primary" />
            最近一次基准测试
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {latest ? (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <Clock className="size-4" />
                <span>{formatDateTime(latest.createdAt)}</span>
                <Badge variant="outline">
                  <Cpu className="mr-1 size-3" />
                  {latestPayload?.model ?? "—"}
                </Badge>
                <Badge variant="outline">样本 {latestPayload?.size ?? "?"}</Badge>
              </div>

              <div className="space-y-3">
                {Object.entries(results)
                  .sort((a, b) => Number(a[0]) - Number(b[0]))
                  .map(([key, r]) => {
                    const pct = maxThroughput > 0 ? Math.round((r.throughput / maxThroughput) * 100) : 0;
                    return (
                      <div key={key} className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium">{r.workers} Worker</span>
                          <span className="text-muted-foreground">
                            {r.seconds.toFixed(2)} 秒 · {r.throughput.toFixed(1)} 条/秒
                          </span>
                        </div>
                        <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Activity className="size-4" />
              暂无基准测试记录。运行 <code className="rounded bg-muted px-1.5 py-0.5">POST /benchmark</code>（ai-worker）后刷新查看。
            </div>
          )}
        </CardContent>
      </Card>

      {/* 任务计数（按类型） */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-serif text-lg">
            <ListChecks className="size-4 text-primary" />
            任务计数（按类型）
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {byType.length === 0 ? (
            <span className="text-sm text-muted-foreground">暂无任务</span>
          ) : (
            byType.map((r) => (
              <Badge key={r.type} variant="secondary" className="gap-1.5">
                {r.type}
                <span className="text-muted-foreground">{r._count._all}</span>
              </Badge>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 p-4 text-sm text-muted-foreground">
          <div className="font-medium text-foreground">触发批量任务（ai-worker 服务）</div>
          <code className="block rounded bg-muted px-2 py-1">curl -X POST http://localhost:8000/benchmark -H &quot;Authorization: Bearer $AI_WORKER_SECRET&quot;</code>
          <code className="block rounded bg-muted px-2 py-1">curl -X POST &quot;http://localhost:8000/reindex?target_type=ITEM&quot; -H &quot;Authorization: Bearer $AI_WORKER_SECRET&quot;</code>
          <div className="text-xs">
            正常用户功能不依赖本服务；发布后的单资源向量化由 Next.js 侧{" "}
            <Link href="/api/cron/ai-jobs" className="underline">/api/cron/ai-jobs</Link> 处理。
          </div>
        </CardContent>
      </Card>
    </PageContainer>
  );
}
