"""Embedding 客户端：OpenAI 兼容 /v1/embeddings（SiliconFlow BGE-M3，1024 维）。"""
import httpx
from . import config


class EmbeddingError(Exception):
    pass


def embed_text(text: str) -> list[float]:
    """文本 → 1024 维向量。失败抛 EmbeddingError。"""
    try:
        r = httpx.post(
            f"{config.AI_BASE_URL}/embeddings",
            headers={
                "Authorization": f"Bearer {config.AI_API_KEY}",
                "Content-Type": "application/json",
            },
            json={"model": config.AI_EMBEDDING_MODEL, "input": text},
            timeout=30.0,
        )
    except httpx.HTTPError as e:
        raise EmbeddingError(f"network: {e}") from e
    if r.status_code != 200:
        raise EmbeddingError(f"embedding {r.status_code}: {r.text[:160]}")
    data = r.json()
    vec = (data.get("data") or [{}])[0].get("embedding")
    if not isinstance(vec, list) or len(vec) == 0:
        raise EmbeddingError("embedding empty")
    if len(vec) != config.AI_EMBEDDING_DIM:
        raise EmbeddingError(f"dim {len(vec)} != {config.AI_EMBEDDING_DIM}")
    return vec
