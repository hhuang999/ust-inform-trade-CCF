import { getEmbeddingConfig } from "./config";
import { AiProviderError } from "./provider";

/**
 * 调用 OpenAI 兼容 /v1/embeddings（默认 SiliconFlow BAAI/bge-m3，1024 维）。
 * 仅负责"文本→向量"。失败抛 AiProviderError，由 jobs.ts 捕获按重试策略处理。
 */
export async function embedText(text: string): Promise<{ vector: number[]; model: string }> {
  const cfg = getEmbeddingConfig();
  if (!cfg) throw new AiProviderError("embedding 未配置");

  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: cfg.model, input: text }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    throw new AiProviderError(`embedding 网络失败：${e instanceof Error ? e.message : String(e)}`);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new AiProviderError(`embedding ${res.status}：${detail.slice(0, 160)}`);
  }

  const data = (await res.json()) as { data?: { embedding?: number[] }[] };
  const vec = data?.data?.[0]?.embedding;
  if (!Array.isArray(vec) || vec.length === 0) {
    throw new AiProviderError("embedding 返回为空");
  }
  if (vec.length !== cfg.dim) {
    throw new AiProviderError(`embedding 维度 ${vec.length} ≠ 配置 ${cfg.dim}`);
  }
  return { vector: vec, model: cfg.model };
}
