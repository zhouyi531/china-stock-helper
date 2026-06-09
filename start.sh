#!/usr/bin/env bash
#
# start.sh — 启动 A 股看盘助手
#
#   ./start.sh          开发模式：同时启动后端(:8787)与前端(:5173)，支持热更新
#   ./start.sh dev      同上
#   ./start.sh prod     生产模式：构建前端并由后端单端口托管(:8787)
#
set -euo pipefail

# 切到脚本所在目录（项目根）
cd "$(dirname "$0")"

MODE="${1:-dev}"

# ---- 1. 依赖检查 ----
if ! command -v node >/dev/null 2>&1; then
  echo "✗ 未找到 node，请先安装 Node.js >= 20" >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "✗ 需要 Node.js >= 20，当前为 $(node -v)" >&2
  exit 1
fi

# ---- 2. 安装 npm 依赖（首次或缺失时）----
if [ ! -d node_modules ]; then
  echo "→ 安装依赖 (npm install)..."
  npm install
fi

# ---- 3. 环境变量 ----
if [ ! -f server/.env ]; then
  echo "→ 未找到 server/.env，从 .env.example 复制一份"
  cp .env.example server/.env
  echo "  请编辑 server/.env 填入 OPENAI_API_KEY（AI 分析必填）"
fi

# ---- 4. 启动 ----
case "$MODE" in
  dev)
    echo "→ 开发模式：后端 http://localhost:8787 ，前端 http://localhost:5173"
    exec npm run dev
    ;;
  prod)
    echo "→ 构建前端 (web/dist)..."
    npm run build -w web
    echo "→ 生产模式：单端口 http://localhost:8787 （后端托管前端）"
    exec npm start
    ;;
  *)
    echo "用法: ./start.sh [dev|prod]" >&2
    exit 1
    ;;
esac
