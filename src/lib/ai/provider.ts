import type { AiChatConfig } from "./config";

export interface ChatImage {
  /** data URL，如 data:image/jpeg;base64,... */
  dataUrl: string;
}

export interface GenerateJsonOptions {
  images?: ChatImage[];
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

/** Provider 调用失败（网络 / HTTP / 解析）统一异常，由 draft.ts 捕获后降级。 */
export class AiProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiProviderError";
  }
}

type TextPart = { type: "text"; text: string };
type ImagePart = { type: "image_url"; image_url: { url: string } };

/**
 * OpenAI 兼容 chat/completions 调用，强制 JSON 输出（response_format json_object）。
 * 仅负责"发消息、拿 JSON"，不校验业务字段。失败抛 AiProviderError，由 draft.ts 捕获降级。
 * 视觉：当传入 images 时，user content 用多模态数组（text + image_url(data URL)）。
 */
export async function generateJson(
  cfg: AiChatConfig,
  system: string,
  userText: string,
  opts: GenerateJsonOptions = {}
): Promise<{ json: unknown; model: string }> {
  const userContent: string | Array<TextPart | ImagePart> = opts.images?.length
    ? [
        { type: "text", text: userText },
        ...opts.images.map((im) => ({
          type: "image_url" as const,
          image_url: { url: im.dataUrl },
        })),
      ]
    : userText;

  const body = {
    model: cfg.model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userContent },
    ],
    response_format: { type: "json_object" },
    max_tokens: opts.maxTokens ?? 800,
    temperature: opts.temperature ?? 0.3,
  };

  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
    });
  } catch (e) {
    throw new AiProviderError(`网络请求失败：${e instanceof Error ? e.message : String(e)}`);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new AiProviderError(`模型服务 ${res.status}：${detail.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.length === 0) {
    throw new AiProviderError("模型返回为空");
  }
  try {
    return { json: JSON.parse(content), model: cfg.model };
  } catch {
    throw new AiProviderError("模型返回不是合法 JSON");
  }
}
