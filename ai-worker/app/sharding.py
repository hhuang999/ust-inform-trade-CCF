"""分片 + 重试策略（纯函数，不依赖 ray/db，便于单测）。"""
from . import config


def shard(items: list, n: int) -> list[list]:
    """把 items 尽量均分到 n 个分片（轮询分配，丢弃空分片）。"""
    if n <= 0:
        n = 1
    buckets: list[list] = [[] for _ in range(n)]
    for i, it in enumerate(items):
        buckets[i % n].append(it)
    return [b for b in buckets if b]


def should_retry(attempts: int, max_attempts: int | None = None) -> bool:
    return attempts < (max_attempts or config.MAX_ATTEMPTS)
