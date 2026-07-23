import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAiDraftEnabled } from "@/lib/ai/config";
import { draftInputSchema, generateDraft } from "@/lib/ai/draft";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 功能开关：未开启时返回 503，前端隐藏入口。
  if (!isAiDraftEnabled()) {
    return NextResponse.json({ enabled: false }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const parsed = draftInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid input", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const { type, text, imageKeys } = parsed.data;

  // 防越权读对象：imageKeys 必须是物品公开桶前缀（public/items/...）。
  if (imageKeys?.length) {
    for (const k of imageKeys) {
      if (!k.startsWith("public/items/")) {
        return NextResponse.json({ error: "invalid image key" }, { status: 400 });
      }
    }
  }

  // generateDraft 内部捕获所有 provider 错误，绝不抛出 → 始终 200。
  const res = await generateDraft({ type, text, imageKeys });
  return NextResponse.json(res);
}
