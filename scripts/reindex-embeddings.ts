/**
 * 一次性/按需重建全部资源向量（REINDEX_ALL 的 TS 单机版；Step 5 的 Ray worker 负责分布式批量）。
 * 用法：在仓库根，注入 AI_* / DATABASE_URL 环境变量后 `tsx scripts/reindex-embeddings.ts`。
 * 跳过内容未变化（contentHash 相同）的资源，幂等可重复运行。
 */
import { prisma } from "@/lib/db";
import { buildResourceText, contentHash } from "@/lib/ai/normalize-resource";
import { embedText } from "@/lib/ai/embedding";
import { upsertEmbedding, getEmbeddingMeta } from "@/lib/ai/embedding-repo";
import type { AiTargetType } from "@prisma/client";

const CAP = 300;

async function reindexType(type: AiTargetType) {
  const rows =
    type === "ITEM"
      ? await prisma.item.findMany({
          where: { deletedAt: null },
          take: CAP,
          select: { id: true, title: true, description: true, category: true, condition: true, priceMode: true, price: true, tags: true, tradeMethods: true, pickupLocation: true },
        })
      : type === "SERVICE"
        ? await prisma.service.findMany({
            where: { deletedAt: null },
            take: CAP,
            select: { id: true, title: true, description: true, qualification: true, categories: true, formats: true, durationTier: true, price: true },
          })
        : await prisma.need.findMany({
            where: { deletedAt: null },
            take: CAP,
            select: { id: true, title: true, description: true, expectedProfile: true, reward: true, expectedTime: true, formatPreference: true, category: true },
          });

  let embedded = 0;
  let skipped = 0;
  for (const r of rows) {
    const text = buildResourceText(type, r as Record<string, unknown>);
    const hash = contentHash(text);
    const meta = await getEmbeddingMeta(type, r.id);
    if (meta?.contentHash === hash) {
      skipped++;
      continue;
    }
    const { vector, model } = await embedText(text);
    await upsertEmbedding({ targetType: type, targetId: r.id, contentHash: hash, model, vector });
    embedded++;
  }
  console.log(`${type}: ${rows.length} rows, embedded=${embedded}, skipped(unchanged)=${skipped}`);
}

async function main() {
  await reindexType("ITEM");
  await reindexType("SERVICE");
  await reindexType("NEED");
  const total = await prisma.resourceEmbedding.count();
  console.log(`\nResourceEmbedding total: ${total}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
