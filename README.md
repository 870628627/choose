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
4. 到“股票对比”选择 2-4 只股票横向对比。
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
