"""FastAPI 入口：HTTP 触发任务处理 / 全量重建 / 基准测试；查询任务状态。

用 AI_WORKER_SECRET（Bearer）保护写接口；GET /status、/health 放行。
"""
from fastapi import FastAPI, Header, HTTPException

from . import config, db, jobs

app = FastAPI(title="UniSwap AI Worker", version="1.0")


def _check_auth(authorization: str | None) -> None:
    # 未配置 secret 时（本地开发）放行。
    if not config.AI_WORKER_SECRET:
        return
    if authorization != f"Bearer {config.AI_WORKER_SECRET}":
        raise HTTPException(status_code=401, detail="unauthorized")


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/status")
def status():
    """任务计数（按 type/status 聚合）。"""
    return {"jobs": db.count_jobs_by_status()}


@app.post("/process")
def process(limit: int = 50, authorization: str | None = Header(None)):
    _check_auth(authorization)
    return jobs.process_pending_jobs(limit=limit)


@app.post("/reindex")
def reindex(target_type: str = "ITEM", authorization: str | None = Header(None)):
    _check_auth(authorization)
    return jobs.reindex_all(target_type)


@app.post("/benchmark")
def benchmark(size: int | None = None, authorization: str | None = Header(None)):
    _check_auth(authorization)
    return jobs.run_benchmark(size=size)
