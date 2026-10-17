# 后端镜像（Cloud Run 服务 kebunsah-api）。构建上下文是仓库根目录：docker build -t kebunsah-api .
# 一个镜像里放 core/ api/ ai-worker/ 三个目录，评估在同一进程里异步跑；将来拆成两个服务只改这个文件和 deploy.yaml。
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/srv/core:/srv/api:/srv/ai-worker

WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY core ./core
COPY api ./api
COPY ai-worker ./ai-worker

# Cloud Run 会设 PORT；本地默认 8080
CMD ["sh", "-c", "exec uvicorn app.main:create_app_from_env --factory --host 0.0.0.0 --port ${PORT:-8080}"]
