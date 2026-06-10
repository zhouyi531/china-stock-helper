# A股看盘助手 (China A-Shares Helper)

一个本地运行的 Web 看盘 + 交易决策辅助工具，面向 A 股短线/日内交易：

- **自定义自选股**：按代码添加/删除关注股票。
- **三层实时指标**：
  - 第一层 个股（双时间维度）：日内分（VWAP、5/15分钟动量、量比、盘口、日内位置、缺口）+ 日线分（MA5/10/20/60 结构与斜率、MACD、RSI14、KDJ、ATR、20日突破、60日位置、量能趋势），合成综合趋势分。
  - 第二层 市场 regime：五大指数（含20日线上下）、涨跌家数、涨停/跌停与最高连板、两市成交额较昨日（U型时段曲线折算），自动判定六种市场状态。
  - 第三层 板块/题材：行业+概念双绑定，板块涨停数实时取自涨停池，按公式计算 `sector_score`。
- **决策引擎**：三层融合为 0-100 机会分 + 7 项入场检查清单 + 硬性风险闸门（恐慌市/落刀/空头结构/临近涨停…），输出 强买/可买/观望/持有/减仓/离场/回避 与中文理由、ATR建议止损、入场时机提示。
- **市场扫描（选股）**：一键扫描沪深全A（按成交额+涨幅取活跃股池），动量/量能/板块/日内位置综合评分，给出当日候选并可直接加自选。
- **离场引擎**：跟踪止盈默认 **ATR 自适应**（≈0.9×日ATR，浮盈越大自动收紧）+ 止损（-3%）状态机；可按个股固定参数。
- **参数回测验证**：个股详情内置日线回测（均线启动/20日突破两种入场，含摩擦成本），并对止盈回撤做参数扫描，用数据确认参数基准值。
- **个股 AI 分析**：连接 OpenAI Responses API，固定提示词前缀（命中 prompt cache）+ 动态三层数据与决策快照，无持仓分析开仓时机、有持仓分析离场时机。

> 评分公式、权重与基准值详见 [docs/决策与评分.md](docs/决策与评分.md)；离场状态机见 [docs/离场条件.md](docs/离场条件.md)。

## 技术栈

- 后端：Node + TypeScript + Fastify + WebSocket，`better-sqlite3` 持久化，`iconv-lite` 解 GBK。
- 前端：React + TypeScript + Vite + Tailwind，`lightweight-charts` 画 K 线。
- 数据源：腾讯行情（主）/ 新浪（备）/ 东方财富（涨跌家数与板块，可降级），可选 Tushare。

## 快速开始

```bash
# 1. 安装依赖（根目录，npm workspaces）
npm install

# 2. 配置环境变量
cp .env.example server/.env
#   编辑 server/.env，至少填入 OPENAI_API_KEY（用于 AI 分析）

# 3. 启动（同时拉起后端 :8787 与前端 :5173）
npm run dev
```

打开 http://localhost:5173 。

> 说明：行情数据来自腾讯/新浪/东方财富的公开接口，部分接口在中国大陆网络环境下最稳定；东方财富（板块、涨跌家数）不可用时会自动降级，相关指标会标注为不可用。

## 环境变量

见 [.env.example](.env.example)。常用项：

| 变量 | 说明 | 默认 |
| --- | --- | --- |
| `PORT` | 后端端口 | `8787` |
| `OPENAI_API_KEY` | OpenAI 密钥（AI 分析必填） | 空 |
| `OPENAI_MODEL` | 模型名 | `gpt-4.1` |
| `EXIT_TRAIL_PCT` | 止盈回撤阈值（留空 = ATR 自适应，推荐） | 空（自适应） |
| `EXIT_STOPLOSS_PCT` | 止损阈值 | `0.03` |
| `TUSHARE_TOKEN` | 可选，增强 Layer2/3 | 空 |

## 脚本

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 同时启动前后端（开发热更新） |
| `npm run build` | 类型检查 + 构建前端（产物在 `web/dist`） |
| `npm run typecheck` | 全量类型检查 |
| `npm test -w @a-shares/server` | 指标数学 / 离场引擎 / 决策闸门 / 回测 单元测试 |

## 部署（单机）

生产环境只跑**一个进程、一个端口**：后端在启动时会自动托管已构建的前端（`web/dist`），
所以 API、WebSocket 与页面都走同源（`http://<host>:8787`），无需单独的前端服务器或 CORS 配置。

> ⚠️ 数据源建议：行情来自腾讯/新浪/东方财富的公开接口，**在中国大陆或邻近亚洲节点的服务器上最稳定**。
> 东方财富（板块、涨跌家数）从海外 IP 访问容易超时/被限流，届时相关指标会自动降级。
> 因此**不建议直接部署到 Vercel**（serverless 不支持常驻轮询循环与 WebSocket，本地 SQLite 也无法持久化，且无大陆节点）。

### 方式一：Docker Compose（推荐）

```bash
# 1. 准备环境变量（注意 Docker 读取的是“根目录”的 .env）
cp .env.example .env
#   编辑 .env，至少填入 OPENAI_API_KEY

# 2. 构建并后台启动
docker compose up -d --build

# 3. 查看日志 / 停止
docker compose logs -f
docker compose down
```

打开 `http://<服务器IP>:8787` 。自选股 / 持仓 / AI 历史保存在 SQLite，已通过 `./data` 卷持久化，
容器重建也不丢数据。

> 跨架构构建（在 x86 服务器部署、本机为 Apple Silicon 等）：`docker compose build` 时加
> `--platform linux/amd64`，或用 `docker buildx`。

### 方式二：纯 Docker

```bash
docker build -t china-a-shares-helper .
docker run -d --name a-shares-helper --init \
  -p 8787:8787 \
  --env-file .env \
  -v "$(pwd)/data:/app/data" \
  china-a-shares-helper
```

### 方式三：裸机 / VPS + PM2（不用 Docker）

```bash
npm ci
npm run build -w web            # 生成 web/dist（由后端托管）
cp .env.example server/.env     # 编辑 OPENAI_API_KEY 等

# 用 PM2 常驻（已附带 ecosystem.config.cjs）
npm i -g pm2
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup         # 开机自启
```

> 不想用 PM2 也可以直接 `npm run build -w web && npm start`（前台运行，后端服务在 `:8787`）。
> 建议在前面加一层 Nginx/Caddy 反代以启用 HTTPS（WebSocket 走 `wss://` 需要正确转发 `Upgrade` 头）。

## 免责声明

本项目仅用于学习与个人辅助，不构成任何投资建议。行情数据来自第三方公开接口，可能有延迟或错误，请自行核实。
