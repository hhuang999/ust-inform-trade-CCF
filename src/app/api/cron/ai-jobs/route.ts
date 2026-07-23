import { NextResponse } from "next/server";
import { processPendingEmbeddingJobs } from "@/lib/ai/jobs";

// AI 任务处理器（TS 侧单 worker）：抢占并处理 PENDING 的 EMBED_RESOURCE。
// 鉴权：Vercel Cron 自动带 CRON_SECRET；Python Ray worker / 手动触发用 AI_WORKER_SECRET。
// 如需周期触发，在 vercel.json crons 加一条 path=/api/cron/ai-jobs 的计划（例如每 5 分钟）。
export async function GET(req: Request) {
  const authz = req.headers.get("authorization");
  const cronOk =
    !!process.env.CRON_SECRET && authz === `Bearer ${process.env.CRON_SECRET}`;
  const workerOk =
    !!process.env.AI_WORKER_SECRET && authz === `Bearer ${process.env.AI_WORKER_SECRET}`;
  if (!cronOk && !workerOk) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await processPendingEmbeddingJobs(50);
  return NextResponse.json({ ok: true, ...result });
}
