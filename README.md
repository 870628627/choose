# AlphaScope 全球资产研究台

一个家庭自用的多资产研究 MVP。A 股自选池支持自动保存基础信息、日频估值行情、财务指标、公告标题，并生成研究评分和风险标签。

本项目允许生成荐股观点、交易方案、目标价和涨跌判断，并在网页端接入 TradingAgents 中文交易报告。页面分为首页 Agent 简介、A 股、美股和加密资产四个区域。

## 技术栈

- 前端：React + Vite + TypeScript + Tailwind CSS
- 后端：Node.js + Express + SQLite
- 数据采集：Python data-worker；A 股行情优先 BaoStock，失败后回退东方财富 / AKShare；美股情绪可优先接 Finnhub
- LLM：网页端接入 TradingAgents 中文交易报告，支持 OpenAI / DeepSeek 等模型配置

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
- `FINNHUB_API_KEY`：美股市场讨论 / 社交情绪优先数据源；未配置时自动降级到 StockTwits / Reddit / Yahoo Finance
- `OPENAI_API_KEY`、`DEEPSEEK_API_KEY`：TradingAgents 模型密钥配置

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

1. 首页查看 TradingAgents 各角色的简短说明。
2. 到“A股”页输入 `600519`、`000001` 或 `300750` 添加自选股，查看本地数据、评分和中文交易报告。
3. 到“美股”页输入 `NVDA`、`AAPL`、`MSFT` 等符号生成中文交易报告。
4. 到“加密”页输入 `BTC-USD`、`ETH-USD`、`SOL-USD` 等符号生成中文交易报告。

## data-worker 命令

```bash
python data-worker/worker.py fetch_stock_basic --code 600519
python data-worker/worker.py fetch_daily_metrics --code 600519
python data-worker/worker.py fetch_financials --code 600519
python data-worker/worker.py fetch_announcements --code 600519
python data-worker/worker.py sync_all --codes 600519,000001
```

所有命令输出 JSON，供后端调用。

## 风险边界

页面底部固定显示：

> AlphaScope 可生成多资产研究、交易观点、目标价和涨跌判断。模型结论可能错误或滞后，实际交易请自行确认数据并控制风险。

系统可以生成：

- 荐股
- 交易方案
- 目标价或价格区间
- 涨跌方向判断
- 风险提示和仓位建议

所有模型输出都可能错误或滞后；实际交易前需要自行核验行情、公告、财务数据和账户风险承受能力。

## 阿里云 ECS 部署

推荐使用 ECS + Docker Compose。容器包含：

- `server`：Express API、SQLite、Python data-worker、AKShare
- `web`：Nginx 托管前端静态文件，并代理 `/api` 到后端

### ECS 首次准备

1. 创建 Ubuntu 22.04 / 24.04 ECS。
2. 安全组开放 `22` 和 `8081`，如需 HTTPS 后续再开放 `443`。
3. 安装 Docker：

```bash
curl -fsSL https://get.docker.com | bash
sudo systemctl enable docker
sudo systemctl start docker
```

4. 克隆项目到固定目录：

```bash
cd /opt
sudo git clone https://github.com/870628627/choose.git
sudo chown -R $USER:$USER /opt/choose
cd /opt/choose
```

5. 首次启动：

```bash
docker compose up -d --build
```

访问：

```text
http://你的ECS公网IP:8081
```

SQLite 数据会持久化到：

```text
/opt/choose/storage/sqlite
```

### GitHub Actions 自动部署

仓库已包含：

```text
.github/workflows/deploy.yml
```

每次推送到 `main` 后，GitHub Actions 会 SSH 到 ECS，执行：

```bash
cd /opt/choose
git fetch origin main
git reset --hard origin/main
docker compose up -d --build
docker image prune -f
```

需要在 GitHub 仓库配置 Secrets：

```text
ALIYUN_HOST=你的ECS公网IP
ALIYUN_USER=登录用户名，例如 root 或 ubuntu
ALIYUN_PORT=22
ALIYUN_SSH_KEY=SSH私钥内容
```

配置位置：

```text
GitHub 仓库 -> Settings -> Secrets and variables -> Actions -> New repository secret
```

如果仓库是私有仓库，ECS 上的 `/opt/choose` 也需要能拉取该仓库。最简单方式是在 GitHub 给 ECS 配一个 deploy key，或者改用 HTTPS token clone。
