"""Postgres 数据访问层（与 Next.js 共用 AiJob / ResourceEmbedding / AiRecommendation 表）。

向量列走原生 SQL（::vector）；任务抢占用 FOR UPDATE SKIP LOCKED。
"""
import contextlib
import uuid
import psycopg2
from . import config


@contextlib.contextmanager
def get_conn():
    c = psycopg2.connect(config.DATABASE_URL)
    try:
        yield c
        c.commit()
    except Exception:
        c.rollback()
        raise
    finally:
        c.close()


def claim_job(job_type: str = "EMBED_RESOURCE") -> tuple | None:
    """原子抢占一个 PENDING 任务（UPDATE ... FOR UPDATE SKIP LOCKED）。返回 (id, targetType, targetId, attempts)。"""
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            WITH claimed AS (
              SELECT id FROM "AiJob"
              WHERE type = %s::"AiJobType" AND status = 'PENDING'::"AiJobStatus"
              ORDER BY "createdAt" ASC LIMIT 1 FOR UPDATE SKIP LOCKED
            )
            UPDATE "AiJob"
            SET status = 'RUNNING'::"AiJobStatus", "startedAt" = now(),
                attempts = attempts + 1, "workerId" = %s
            FROM claimed WHERE "AiJob".id = claimed.id
            RETURNING "AiJob".id, "AiJob"."targetType"::text, "AiJob"."targetId", "AiJob".attempts
            """,
            (job_type, f"py-{uuid.uuid4()}"),
        )
        return cur.fetchone()


def finish_job(job_id: str, status: str, error: str | None = None) -> None:
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            UPDATE "AiJob" SET status = %s::"AiJobStatus", "finishedAt" = now(), error = %s WHERE id = %s
            """,
            (status, error, job_id),
        )


def requeue_job(job_id: str, error: str) -> None:
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """UPDATE "AiJob" SET status = 'PENDING'::"AiJobStatus", error = %s WHERE id = %s""",
            (error, job_id),
        )


def get_embedding_meta(target_type: str, target_id: str) -> str | None:
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            '''SELECT "contentHash" FROM "ResourceEmbedding" WHERE "targetType" = %s::"AiTargetType" AND "targetId" = %s''',
            (target_type, target_id),
        )
        row = cur.fetchone()
        return row[0] if row else None


def upsert_embedding(target_type: str, target_id: str, content_hash: str, model: str, vector: list[float]) -> None:
    vec_str = "[" + ",".join(str(x) for x in vector) + "]"
    rid = str(uuid.uuid4())
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            INSERT INTO "ResourceEmbedding"
              ("id","targetType","targetId","contentHash","model","embedding","createdAt","updatedAt")
            VALUES (%s, %s::"AiTargetType", %s, %s, %s, %s::vector, now(), now())
            ON CONFLICT ("targetType","targetId") DO UPDATE SET
              "contentHash" = EXCLUDED."contentHash", "model" = EXCLUDED."model",
              "embedding" = EXCLUDED."embedding", "updatedAt" = now()
            """,
            (rid, target_type, target_id, content_hash, model, vec_str),
        )


def fetch_resource(target_type: str, target_id: str) -> dict | None:
    select = {
        "ITEM": 'id, title, description, category, condition, "priceMode", price, tags, "tradeMethods", "pickupLocation"',
        "SERVICE": 'id, title, description, qualification, categories, formats, "durationTier", price',
        "NEED": 'id, title, description, "expectedProfile", reward, "expectedTime", "formatPreference", category',
    }[target_type]
    table = {"ITEM": "Item", "SERVICE": "Service", "NEED": "Need"}[target_type]
    with get_conn() as c, c.cursor() as cur:
        cur.execute(f'SELECT {select} FROM "{table}" WHERE id = %s', (target_id,))
        cols = [d[0] for d in cur.description]
        row = cur.fetchone()
        return dict(zip(cols, row)) if row else None


def fetch_all_resource_ids(target_type: str, limit: int = 1000) -> list[str]:
    table = {"ITEM": "Item", "SERVICE": "Service", "NEED": "Need"}[target_type]
    with get_conn() as c, c.cursor() as cur:
        cur.execute(f'SELECT id FROM "{table}" WHERE "deletedAt" IS NULL LIMIT %s', (limit,))
        return [r[0] for r in cur.fetchall()]


def count_jobs_by_status() -> dict:
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            SELECT type, status, count(*) FROM "AiJob" GROUP BY type, status ORDER BY type, status
            """
        )
        rows = cur.fetchall()
    return {f"{t}/{s}": n for (t, s, n) in rows}


def insert_job(job_type: str, status: str = "PENDING", payload: dict | None = None) -> str:
    jid = str(uuid.uuid4())
    import json
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            INSERT INTO "AiJob" (id, type, status, payload, "createdAt")
            VALUES (%s, %s::"AiJobType", %s::"AiJobStatus", %s::jsonb, now())
            """,
            (jid, job_type, status, json.dumps(payload) if payload else None),
        )
    return jid
