"""配置：从环境变量读取（与 Next.js 侧共用同一套 AI_* / DATABASE_URL）。"""
import os

DATABASE_URL = os.environ.get("DATABASE_URL", "")

# Embedding：缺省回退到聊天模型配置（同一供应商 SiliconFlow）。
AI_BASE_URL = (
    os.environ.get("AI_EMBEDDING_BASE_URL")
    or os.environ.get("AI_BASE_URL")
    or "https://api.siliconflow.cn/v1"
).rstrip("/")
AI_API_KEY = os.environ.get("AI_EMBEDDING_API_KEY") or os.environ.get("AI_API_KEY", "")
AI_EMBEDDING_MODEL = os.environ.get("AI_EMBEDDING_MODEL", "BAAI/bge-m3")
AI_EMBEDDING_DIM = int(os.environ.get("AI_EMBEDDING_DIM", "1024"))

# Worker
AI_WORKER_SECRET = os.environ.get("AI_WORKER_SECRET", "")
WORKER_ID = os.environ.get("RAY_ADDRESS", "py-worker")  # 占位；真正 workerId 在 jobs 内生成
WORKER_BATCH_SIZE = int(os.environ.get("WORKER_BATCH_SIZE", "20"))
MAX_ATTEMPTS = 3
BENCHMARK_DATASET_SIZE = int(os.environ.get("BENCHMARK_DATASET_SIZE", "60"))
