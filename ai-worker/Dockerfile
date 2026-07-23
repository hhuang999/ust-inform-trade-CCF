FROM python:3.11-slim

WORKDIR /app

# 依赖单独一层，利用缓存
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# FastAPI 经 uvicorn 启动；Ray 在进程内惰性初始化（reindex/benchmark 触发）
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
