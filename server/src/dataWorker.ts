import { spawn } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";

export async function runDataWorker<T>(task: string, args: Record<string, string> = {}) {
  const python = process.env.DATA_WORKER_PYTHON || "python";
  const workerPath = path.resolve(process.cwd(), process.env.DATA_WORKER_PATH || "../data-worker/worker.py");
  const params = [workerPath, task];

  for (const [key, value] of Object.entries(args)) {
    params.push(`--${key}`, value);
  }

  return new Promise<T>((resolve) => {
    const child = spawn(python, params, {
      cwd: process.cwd(),
      env: process.env,
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (payload: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(payload);
    };

    const timer = setTimeout(() => {
      child.kill();
      console.warn(`data-worker ${task} timed out; using demo fallback`);
      finish(fallbackWorker(task, args) as T);
    }, Number(process.env.DATA_WORKER_TIMEOUT_MS || 60000));

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", () => finish(fallbackWorker(task, args) as T));
    child.on("close", (code) => {
      if (settled) return;
      if (code !== 0) {
        console.warn(stderr || `data-worker exited with code ${code}; using demo fallback`);
        finish(fallbackWorker(task, args) as T);
        return;
      }

      try {
        finish(JSON.parse(stdout) as T);
      } catch (error) {
        console.warn(`data-worker returned invalid JSON: ${(error as Error).message}; using demo fallback`);
        finish(fallbackWorker(task, args) as T);
      }
    });
  });
}

function fallbackWorker(task: string, args: Record<string, string>) {
  const code = args.code || "";
  if (task === "fetch_stock_basic") return fallbackBasic(code);
  if (task === "fetch_daily_metrics") return fallbackDaily(code);
  if (task === "fetch_financials") return fallbackFinancials(code);
  if (task === "fetch_announcements") return fallbackAnnouncements(code);
  if (task === "sync_all") {
    const codes = (args.codes || "").split(",").map((item) => item.trim()).filter(Boolean);
    return { stocks: codes.map((item) => syncOne(item)) };
  }
  return {};
}

function syncOne(code: string) {
  return {
    basic: fallbackBasic(code),
    daily_metrics: fallbackDaily(code),
    financial_metrics: fallbackFinancials(code),
    announcements: fallbackAnnouncements(code)
  };
}

function fallbackBasic(code: string) {
  const known: Record<string, { name: string; industry: string; company_profile: string }> = {
    "600519": { name: "贵州茅台", industry: "白酒", company_profile: "主营贵州茅台酒及系列酒的生产与销售。" },
    "000001": { name: "平安银行", industry: "银行", company_profile: "全国性股份制商业银行，提供公司、零售和金融市场业务。" },
    "300750": { name: "宁德时代", industry: "电池", company_profile: "主营动力电池和储能电池系统研发、生产和销售。" }
  };
  const stock = known[code];
  return {
    code,
    market: code.startsWith("6") ? "SH" : code.startsWith("0") || code.startsWith("3") ? "SZ" : "UNKNOWN",
    name: stock?.name || `A股${code}`,
    industry: stock?.industry || "未识别行业",
    company_profile: stock?.company_profile || "演示数据：公司基础资料待接入正式数据源后补充。",
    listing_date: "2001-01-01"
  };
}

function seeded(code: string) {
  let seed = Number.parseInt(crypto.createHash("sha256").update(code).digest("hex").slice(0, 8), 16);
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

function between(next: () => number, min: number, max: number) {
  return min + next() * (max - min);
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function fallbackDaily(code: string) {
  const next = seeded(code);
  const today = new Date();
  let price = between(next, 8, 240);
  const pe = between(next, 8, 65);
  const pb = between(next, 0.8, 9);
  return Array.from({ length: 20 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (19 - index));
    price = Math.max(1, price * (1 + between(next, -0.035, 0.035)));
    return {
      trade_date: date.toISOString().slice(0, 10),
      close_price: round(price),
      pe: round(pe * between(next, 0.96, 1.04)),
      pe_ttm: round(pe * between(next, 0.96, 1.04)),
      pb: round(pb * between(next, 0.96, 1.04)),
      ps: round(between(next, 1, 12)),
      dividend_yield: round(between(next, 0, 4.5)),
      market_cap: round(between(next, 80, 25000)),
      turnover_rate: round(between(next, 0.2, 7)),
      source: "node-demo"
    };
  });
}

function fallbackFinancials(code: string) {
  const next = seeded(`${code}-financial`);
  let revenue = between(next, 80, 2500);
  return ["2023-12-31", "2024-06-30", "2024-12-31", "2025-06-30", "2025-12-31"].map((period) => {
    const revenueGrowth = between(next, -12, 35);
    const netProfitGrowth = between(next, -20, 45);
    const netMargin = between(next, 5, 35);
    revenue *= 1 + revenueGrowth / 100;
    return {
      report_period: period,
      revenue: round(revenue),
      net_profit: round((revenue * netMargin) / 100),
      revenue_growth: round(revenueGrowth),
      net_profit_growth: round(netProfitGrowth),
      gross_margin: round(between(next, 18, 68)),
      net_margin: round(netMargin),
      roe: round(between(next, 4, 32)),
      debt_asset_ratio: round(between(next, 18, 78)),
      operating_cash_flow: round(between(next, -60, 600)),
      source: "node-demo"
    };
  });
}

function fallbackAnnouncements(code: string) {
  const basic = fallbackBasic(code);
  const templates = [
    ["年度报告摘要", "定期报告"],
    ["关于召开年度股东大会的通知", "股东大会"],
    ["关于经营情况阶段性说明的公告", "经营公告"],
    ["关于控股股东减持计划期限届满的公告", "权益变动"],
    ["关于收到监管问询函并回复的公告", "监管问询"]
  ];
  const today = new Date();
  return templates.map(([title, announcement_type], index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - index * 17 - 2);
    return {
      title: `${basic.name}：${title}`,
      published_at: date.toISOString().slice(0, 10),
      announcement_type,
      url: `https://www.cninfo.com.cn/new/disclosure/stock?stockCode=${code}`,
      source: "node-demo-cninfo"
    };
  });
}
