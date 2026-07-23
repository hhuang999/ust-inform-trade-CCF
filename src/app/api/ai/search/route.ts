import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { isAiSearchEnabled } from "@/lib/ai/config";
import {
  hybridSearchItems,
  hybridSearchServices,
  hybridSearchNeeds,
} from "@/lib/ai/hybrid-search";

const inputSchema = z.object({
  targetType: z.enum(["ITEM", "SERVICE", "NEED"]),
  query: z.string().trim().min(1).max(200),
  page: z.number().int().min(1).default(1),
  filters: z
    .object({
      category: z.string().optional(),
      minPrice: z.number().optional(),
      maxPrice: z.number().optional(),
    })
    .default({}),
});

/**
 * POST /api/ai/search —— 程序化/客户端混合检索入口（列表页直接调用服务端函数，不经此路由）。
 * 鉴权：登录用户。开关关 → 503。失败 → 503 供调用方回退关键词。
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isAiSearchEnabled()) {
    return NextResponse.json({ enabled: false }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid input", issues: parsed.error.issues }, { status: 400 });
  }
  const { targetType, query, page, filters } = parsed.data;

  try {
    if (targetType === "ITEM") {
      const r = await hybridSearchItems({
        status: ["AVAILABLE"],
        category: filters.category,
        minPrice: filters.minPrice,
        maxPrice: filters.maxPrice,
        search: query,
        page,
        pageSize: 12,
      });
      return NextResponse.json(r);
    }
    if (targetType === "SERVICE") {
      const r = await hybridSearchServices({ status: ["ACTIVE"], category: filters.category, search: query, page, pageSize: 12 });
      return NextResponse.json(r);
    }
    const r = await hybridSearchNeeds({ status: ["OPEN"], category: filters.category, search: query, page, pageSize: 12 });
    return NextResponse.json(r);
  } catch {
    return NextResponse.json({ error: "ai_search_failed" }, { status: 503 });
  }
}
