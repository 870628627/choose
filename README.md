# 家庭版 A 股研究小本自动数据版

一个家庭自用的 A 股研究、对比和复盘 MVP。输入股票代码后，系统自动保存基础信息、日频估值行情、财务指标、公告标题，并生成研究评分、风险标签和模拟 AI 解释。

本项目不做荐股、不做交易、不提供目标价、不预测涨跌。

## 技术栈

- 前端：React + Vite + TypeScript + Tailwind CSS
- 后端：Node.js + Express + SQLite
- 数据采集：Python data-worker，优先 AKShare，失败时回退演示数据
- AI：MVP 使用模拟 AI 分析，预留 OpenAI / DeepSeek 配置

## 目录

```text
.
├── prd.md
├── server
│   ├── src
│   └── data
├── web
│   └── src
└── data-worker
    └── worker.py
```

## 环境要求

- Node.js 22+
- Python 3.9+
- 可选：`pip install -r data-worker/requirements.txt`

没有安装 AKShare 也可以运行 MVP，data-worker 会返回演示数据。

## 安装

```bash
npm install
npm run install:all
```

可选安装 Python 依赖：

```bash
pip install -r data-worker/requirements.txt
```

## 配置

复制 `.env.example` 到 `server/.env`，按需修改：

```bash
copy .env.example server\.env
```

关键配置：

- `DATABASE_PATH`：SQLite 数据库路径，默认 `./data/app.db`
- `DATA_WORKER_PYTHON`：Python 命令，默认 `python`
- `DATA_WORKER_PATH`：data-worker 脚本路径
- `TUSHARE_TOKEN`：预留 Tushare token
- `AI_PROVIDER`、`OPENAI_API_KEY`、`DEEPSEEK_API_KEY`：预留 AI 服务配置

## 启动

```bash
npm run dev
```

- 前端：http://localhost:5173
- 后端：http://localhost:3001
- 健康检查：http://localhost:3001/api/health

首次启动后端会自动创建 SQLite 表。

如果 `3001` 已被占用，可以临时改端口：

```bash
set PORT=3101 && npm run dev --prefix server
set VITE_API_PROXY_TARGET=http://localhost:3101 && npm run dev --prefix web
```

## 常用操作

1. 在首页输入 `600519`、`000001` 或 `300750` 添加股票。
2. 到“同步管理”点击“同步全部自选股”。
3. 打开股票详情页查看自动数据、研究评分、风险标签、AI 解释和家庭笔记。
4. 到“股票对比”选择 2-3 只股票横向对比。
5. 到“风险排雷”查看所有股票风险标签。
6. 到“复盘”记录当时判断和后续结果。

## data-worker 命令

```bash
python data-worker/worker.py fetch_stock_basic --code 600519
python data-worker/worker.py fetch_daily_metrics --code 600519
python data-worker/worker.py fetch_financials --code 600519
python data-worker/worker.py fetch_announcements --code 600519
python data-worker/worker.py sync_all --codes 600519,000001
```

所有命令输出 JSON，供后端调用。

## 合规边界

页面底部固定显示：

> 本工具仅用于家庭自用的股票信息整理、研究对比和复盘，不构成任何投资建议。股市有风险，投资需谨慎。

系统不会实现：

- 荐股
- 目标价
- 预测涨跌
- 自动买卖点
- 实时交易
- 分钟级行情
