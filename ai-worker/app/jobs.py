"""任务处理 + Ray 分布式批处理（EMBED_RESOURCE / REINDEX_ALL / BENCHMARK）。"""
import hashlib
import time
from collections import Counter

import ray

from . import config, db, embedding, matching
from .sharding import shard, should_retry


def _hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _process_one(target_type: str, target_id: str) -> str:
    """单资源：取内容→(hash 跳过)→embed→upsert。返回 embedded/skip/missing。"""
    row = db.fetch_resource(target_type, target_id)
    if not row:
        return "missing"
    text = matching.build_resource_text(target_type, row)
    h = _hash(text)
    if db.get_embedding_meta(target_type, target_id) == h:
        return "skip"
    vec = embedding.embed_text(text)
    db.upsert_embedding(target_type, target_id, h, config.AI_EMBEDDING_MODEL, vec)
    return "embedded"


def process_pending_jobs(limit: int | None = None, job_type: str = "EMBED_RESOURCE") -> dict:
    """抢占并处理 PENDING 任务（单 worker 串行）。失败按 attempts 重试，最多 MAX_ATTEMPTS。"""
    limit = limit or config.WORKER_BATCH_SIZE
    processed = succeeded = failed = 0
    for _ in range(limit):
        job = db.claim_job(job_type)
        if not job:
            break
        job_id, target_type, target_id, attempts = job
        processed += 1
        try:
            _process_one(target_type, target_id)
            db.finish_job(job_id, "SUCCEEDED")
            succeeded += 1
        except Exception as e:  # noqa: BLE001
            if should_retry(attempts):
                db.requeue_job(job_id, str(e)[:500])
            else:
                db.finish_job(job_id, "FAILED", str(e)[:500])
            failed += 1
    return {"processed": processed, "succeeded": succeeded, "failed": failed}


@ray.remote
def _embed_one_remote(target_type: str, target_id: str) -> str:
    try:
        return _process_one(target_type, target_id)
    except Exception as e:  # noqa: BLE001
        return "error"


@ray.remote
def _embed_text_remote(text: str):
    return embedding.embed_text(text)


_ray_inited = False


def _ensure_ray():
    """惰性初始化 Ray（仅 reindex/benchmark 需要；status/process 与单测不触发）。"""
    global _ray_inited
    if not _ray_inited:
        ray.init(ignore_reinit_error=True, include_dashboard=False, log_to_driver=False)
        _ray_inited = True


def _run_with_workers(texts: list[str], n: int) -> list:
    """至多 n 个 Ray 任务并发的滚动窗口；用于 benchmark 的 1/2/4 worker 对比。"""
    pending: list = []
    done: list = []
    it = iter(texts)
    for _ in range(n):
        t = next(it, None)
        if t is None:
            break
        pending.append(_embed_text_remote.remote(t))
    while pending:
        ready, pending = ray.wait(pending, num_returns=1)
        done.extend(ray.get(ready))
        t = next(it, None)
        if t is not None:
            pending.append(_embed_text_remote.remote(t))
    return done


def reindex_all(target_type: str = "ITEM") -> dict:
    """全量重建某类型资源向量（Ray 并行）。"""
    ids = db.fetch_all_resource_ids(target_type)
    if not ids:
        return {"target": target_type, "total": 0, "seconds": 0, "breakdown": {}, "throughput": 0}
    t0 = time.time()
    _ensure_ray()
    results = ray.get([_embed_one_remote.remote(target_type, i) for i in ids])
    dt = time.time() - t0
    c = Counter(results)
    return {
        "target": target_type,
        "total": len(ids),
        "seconds": round(dt, 3),
        "breakdown": dict(c),
        "throughput": round(len(ids) / dt, 2) if dt > 0 else 0,
    }


def run_benchmark(worker_counts: tuple = (1, 2, 4), size: int | None = None) -> dict:
    """
    对固定测试文本集（与生产数据分离）分别用 1/2/4 worker 跑嵌入，
    记录耗时与吞吐量，写入一条 BENCHMARK 任务（payload）。
    """
    size = size or config.BENCHMARK_DATASET_SIZE
    texts = [f"基准样本 {i}：二手 显示器 书籍 辅导 简历 翻译 设计 出售" for i in range(size)]
    results: dict = {}
    for n in worker_counts:
        t0 = time.time()
        _ensure_ray()
        _run_with_workers(texts, n)
        dt = time.time() - t0
        results[str(n)] = {
            "workers": n,
            "seconds": round(dt, 3),
            "throughput": round(size / dt, 2) if dt > 0 else 0,
        }
    db.insert_job(
        "BENCHMARK",
        status="SUCCEEDED",
        payload={"size": size, "model": config.AI_EMBEDDING_MODEL, "results": results},
    )
    return results
