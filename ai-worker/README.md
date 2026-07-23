# UniSwap AI Worker（Python + Ray）

负责批量向量生成、批量撮合与多 Worker 性能基准（FEATURE_DEV §9）。与 Next.js 应用共用同一套
`AiJob / ResourceEmbedding / AiRecommendation` 表与 `DATABASE_URL / AI_*` 环境变量，互不侵入交易业务。

- **正常用户功能不依赖本服务**：Next.js 侧有 TS 单机 worker（`/api/cron/ai-jobs` + `src/lib/ai/jobs.ts`）
  处理发布后的单资源 `EMBED_RESOURCE`。本服务只负责 **批量重建（REINDEX_ALL）** 与 **基准（BENCHMARK）**。
- **Ray** 只参与可并行化的批处理；FastAPI 的 `/status`、`/process` 无需 Ray。

## 运行

```bash
cd ai-worker
pip install -r requirements.txt

# 环境变量（与 Next.js 共用；可从仓库根 .env.local source）
export DATABASE_URL="postgresql://..."
export AI_API_KEY="sk-..." AI_BASE_URL="https://api.siliconflow.cn/v1"
export AI_EMBEDDING_MODEL="BAAI/bge-m3" AI_EMBEDDING_DIM=1024
export AI_WORKER_SECRET="ust-ai-worker-2026"

uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## 接口

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/health` | 无 | 存活检查 |
| GET | `/status` | 无 | `AiJob` 按 type/status 聚合计数 |
| POST | `/process?limit=50` | Bearer | 抢占处理 PENDING `EMBED_RESOURCE`（单 worker 串行） |
| POST | `/reindex?target_type=ITEM` | Bearer | Ray 并行全量重建某类型向量 |
| POST | `/benchmark?size=60` | Bearer | 1/2/4 Worker 跑嵌入基准，结果写入一条 `BENCHMARK` 任务 |

## 比赛演示（§9.4）

1. `POST /benchmark?size=60` —— 对固定测试文本集（与生产数据分离）分别用 1/2/4 并发跑嵌入。
2. 查看 `/admin/ai-benchmark`（Next.js）：展示各档耗时与吞吐量（条/秒），任务被分片到不同 Worker。
3. `POST /reindex?target_type=ITEM` —— 展示全量重建的总耗时与吞吐。

## 测试

```bash
cd ai-worker && python -m pytest tests/ -q
```

纯逻辑测试（`matching` 规则理由、`sharding` 分片与重试边界）无需 Ray/DB；集成测试（`claim_job`
幂等、重复执行不产生重复向量）需配置 `DATABASE_URL` 后运行。
