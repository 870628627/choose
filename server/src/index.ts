import "dotenv/config";
import cors from "cors";
import express from "express";
import { z } from "zod";
import { bearerToken, createSession, createUser, requireAuth, revokeSession, verifyUser } from "./auth.js";
import { addUserStock, db, getStockByCode, getUserStockByCode, listStocks, listUserStockCodes, removeUserStock } from "./db.js";
import { runDataWorker } from "./dataWorker.js";
import { cancelReportJobForUser, createReportJob, deleteReportJobForUser, getReportJobForUser, initializeReportJobQueue, listReportJobsForUser } from "./reportJobs.js";
import { createResearchScore } from "./scoring.js";
import type { AuthenticatedRequest } from "./auth.js";
import type { TradingAgentsReport, WorkerStockBasic, WorkerStockPayload } from "./types.js";
import type { WorkerAnnouncement, WorkerDailyMetric, WorkerFinancialMetric } from "./types.js";

const app = express();
const port = Number(process.env.PORT || 3001);
const requestTimeoutMs = Number(process.env.SERVER_REQUEST_TIMEOUT_MS || 900000);
const socketTimeoutMs = Number(process.env.SERVER_SOCKET_TIMEOUT_MS || 0);

app.use(cors());
app.use(express.json());

const addStockSchema = z.object({ code: z.string().regex(/^\d{6}$/) });
const noteSchema = z.object({
  author: z.string().min(1).max(20),
  content: z.string().min(1).max(2000)
});
const reviewSchema = z.object({
  stock_id: z.number().int().positive(),
  review_date: z.string().min(8),
  initial_judgement: z.string().min(1).max(2000),
  observed_result: z.string().max(2000).optional().default(""),
  lessons: z.string().max(2000).optional().default("")
});
const tradingAgentsReportSchema = z.object({
  trade_date: z.string().min(8).optional()
});
const globalTradingAgentsReportSchema = z.object({
  symbol: z.string().min(1).max(32).regex(/^[A-Za-z0-9._-]+$/),
  trade_date: z.string().min(8).optional()
});
const authSchema = z.object({
  email: z.string().trim().email("请输入有效邮箱").max(254),
  password: z.string().min(8, "密码至少 8 位").max(128)
});
const loginSchema = authSchema;

function assetTypeForSymbol(symbol: string) {
  const normalized = symbol.trim().toUpperCase();
  if (/^\d{6}$/.test(normalized) || /^\d{6}\.(SS|SZ|SH)$/.test(normalized)) return "a-share";
  if (normalized.endsWith("-USD") || normalized.endsWith("-USDT")) return "crypto";
  return "us";
}

function reportRow(row: Record<string, unknown>) {
  const id = Number(row.id);
  const report = JSON.parse(String(row.report_json)) as TradingAgentsReport;
  return {
    id,
    asset_type: String(row.asset_type),
    symbol: String(row.symbol),
    display_name: row.display_name ? String(row.display_name) : "",
    trade_date: String(row.trade_date),
    created_at: String(row.created_at),
    report: { ...report, record_id: id }
  };
}

function upsertStock(basic: WorkerStockBasic) {
  db.prepare(
    `
      INSERT INTO stocks (code, market, name, industry, company_profile, listing_date, updated_at)
      VALUES (@code, @market, @name, @industry, @company_profile, @listing_date, CURRENT_TIMESTAMP)
      ON CONFLICT(code) DO UPDATE SET
        market = excluded.market,
        name = excluded.name,
        industry = excluded.industry,
        company_profile = excluded.company_profile,
        listing_date = excluded.listing_date,
        updated_at = CURRENT_TIMESTAMP
    `
  ).run(basic);

  return getStockByCode(basic.code) as { id: number; code: string };
}

function persistWorkerPayload(payload: WorkerStockPayload) {
  const stock = upsertStock(payload.basic);

  const insertDaily = db.prepare(
    `
      INSERT INTO daily_metrics (
        stock_id, trade_date, close_price, pe, pe_ttm, pb, ps, dividend_yield, market_cap, turnover_rate, source
      ) VALUES (
        @stock_id, @trade_date, @close_price, @pe, @pe_ttm, @pb, @ps, @dividend_yield, @market_cap, @turnover_rate, @source
      )
      ON CONFLICT(stock_id, trade_date) DO UPDATE SET
        close_price = excluded.close_price,
        pe = excluded.pe,
        pe_ttm = excluded.pe_ttm,
        pb = excluded.pb,
        ps = excluded.ps,
        dividend_yield = excluded.dividend_yield,
        market_cap = excluded.market_cap,
        turnover_rate = excluded.turnover_rate,
        source = excluded.source
    `
  );
  const insertFinancial = db.prepare(
    `
      INSERT INTO financial_metrics (
        stock_id, report_period, revenue, net_profit, revenue_growth, net_profit_growth,
        gross_margin, net_margin, roe, debt_asset_ratio, operating_cash_flow, source
      ) VALUES (
        @stock_id, @report_period, @revenue, @net_profit, @revenue_growth, @net_profit_growth,
        @gross_margin, @net_margin, @roe, @debt_asset_ratio, @operating_cash_flow, @source
      )
      ON CONFLICT(stock_id, report_period) DO UPDATE SET
        revenue = excluded.revenue,
        net_profit = excluded.net_profit,
        revenue_growth = excluded.revenue_growth,
        net_profit_growth = excluded.net_profit_growth,
        gross_margin = excluded.gross_margin,
        net_margin = excluded.net_margin,
        roe = excluded.roe,
        debt_asset_ratio = excluded.debt_asset_ratio,
        operating_cash_flow = excluded.operating_cash_flow,
        source = excluded.source
    `
  );
  const insertAnnouncement = db.prepare(
    `
      INSERT OR IGNORE INTO announcements (
        stock_id, title, published_at, announcement_type, url, source
      ) VALUES (
        @stock_id, @title, @published_at, @announcement_type, @url, @source
      )
    `
  );

  db.exec("BEGIN");
  try {
    for (const item of payload.daily_metrics || []) {
      insertDaily.run({ stock_id: stock.id, source: "data-worker", ...item });
    }
    for (const item of payload.financial_metrics || []) {
      insertFinancial.run({ stock_id: stock.id, source: "data-worker", ...item });
    }
    for (const item of payload.announcements || []) {
      insertAnnouncement.run({ stock_id: stock.id, source: "cninfo", ...item });
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  const score = createResearchScore(stock.id);
  return { stock, score };
}

async function fetchPayloadByTasks(code: string): Promise<WorkerStockPayload> {
  const [basic, daily_metrics, financial_metrics, announcements] = await Promise.all([
    runDataWorker<WorkerStockBasic>("fetch_stock_basic", { code }),
    runDataWorker<WorkerDailyMetric[]>("fetch_daily_metrics", { code }),
    runDataWorker<WorkerFinancialMetric[]>("fetch_financials", { code }),
    runDataWorker<WorkerAnnouncement[]>("fetch_announcements", { code })
  ]);

  return { basic, daily_metrics, financial_metrics, announcements };
}

function withParsedRiskTags<T extends Record<string, unknown>>(row: T) {
  return {
    ...row,
    risk_tags: row.risk_tags ? JSON.parse(String(row.risk_tags)) : []
  };
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "alphascope-server" });
});

app.post("/api/auth/register", (req, res, next) => {
  try {
    const body = authSchema.parse(req.body ?? {});
    const user = createUser(body.email, body.password);
    if (!user) {
      res.status(400).json({ error: "注册失败" });
      return;
    }
    const token = createSession(user.id);
    res.status(201).json({ token, user });
  } catch (error) {
    const message = error instanceof Error && error.message.includes("UNIQUE")
      ? "邮箱已注册"
      : (error as Error).message;
    next(new Error(message));
  }
});

app.post("/api/auth/login", (req, res, next) => {
  try {
    const body = loginSchema.parse(req.body ?? {});
    const user = verifyUser(body.email, body.password);
    if (!user) {
      res.status(401).json({ error: "邮箱或密码不正确" });
      return;
    }
    const token = createSession(user.id);
    res.json({ token, user });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/logout", requireAuth, (req, res) => {
  const token = bearerToken(req);
  if (token) revokeSession(token);
  res.json({ ok: true });
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ user: (req as AuthenticatedRequest).user });
});

app.get("/api/reports", requireAuth, (req, res) => {
  const user = (req as AuthenticatedRequest).user;
  const assetType = typeof req.query.asset_type === "string" ? req.query.asset_type : "";
  const allowedTypes = new Set(["a-share", "us", "crypto"]);
  const rows = assetType && allowedTypes.has(assetType)
    ? db
      .prepare(
        `
        SELECT * FROM trading_reports
        WHERE user_id = ? AND asset_type = ? AND deleted_at IS NULL
        ORDER BY created_at DESC, id DESC
        LIMIT 100
      `
      )
      .all(user.id, assetType)
    : db
      .prepare(
        `
        SELECT * FROM trading_reports
        WHERE user_id = ? AND deleted_at IS NULL
        ORDER BY created_at DESC, id DESC
        LIMIT 100
      `
      )
      .all(user.id);
  res.json(rows.map((row) => reportRow(row as Record<string, unknown>)));
});

app.delete("/api/reports/:id", requireAuth, (req, res) => {
  const user = (req as AuthenticatedRequest).user;
  const id = Number(req.params.id);
  db.prepare(
    `
    UPDATE trading_reports
    SET deleted_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ? AND deleted_at IS NULL
  `
  ).run(id, user.id);
  res.json({ ok: true });
});

app.get("/api/report-jobs", requireAuth, (req, res) => {
  const user = (req as AuthenticatedRequest).user;
  const assetType = typeof req.query.asset_type === "string" ? req.query.asset_type : "";
  res.json(listReportJobsForUser(user.id, assetType));
});

app.get("/api/report-jobs/:id", requireAuth, (req, res) => {
  const user = (req as AuthenticatedRequest).user;
  const job = getReportJobForUser(Number(req.params.id), user.id);
  if (!job) {
    res.status(404).json({ error: "Report job not found" });
    return;
  }
  res.json(job);
});

app.post("/api/report-jobs/:id/cancel", requireAuth, (req, res) => {
  const user = (req as AuthenticatedRequest).user;
  const job = cancelReportJobForUser(Number(req.params.id), user.id);
  if (!job) {
    res.status(404).json({ error: "Report job not found" });
    return;
  }
  res.json(job);
});

app.delete("/api/report-jobs/:id", requireAuth, (req, res, next) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const result = deleteReportJobForUser(Number(req.params.id), user.id);
    if (!result) {
      res.status(404).json({ error: "Report job not found" });
      return;
    }
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.get("/api/stocks", requireAuth, (req, res) => {
  const user = (req as AuthenticatedRequest).user;
  res.json(listStocks(user.id).map((item) => withParsedRiskTags(item as Record<string, unknown>)));
});

app.post("/api/stocks", requireAuth, async (req, res, next) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const { code } = addStockSchema.parse(req.body);
    const basic = await runDataWorker<WorkerStockBasic>("fetch_stock_basic", { code });
    const stock = upsertStock(basic);
    addUserStock(user.id, stock.id);
    res.status(201).json(stock);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/stocks/:code", requireAuth, (req, res, next) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const stock = getUserStockByCode(user.id, req.params.code) as { id: number } | undefined;
    if (!stock) {
      res.status(404).json({ error: "Stock not found" });
      return;
    }

    removeUserStock(user.id, stock.id);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/stocks/:code", requireAuth, (req, res) => {
  const user = (req as AuthenticatedRequest).user;
  const stock = getUserStockByCode(user.id, req.params.code) as Record<string, unknown> | undefined;
  if (!stock) {
    res.status(404).json({ error: "Stock not found" });
    return;
  }
  const stockId = Number(stock.id);
  const daily_metrics = db
    .prepare("SELECT * FROM daily_metrics WHERE stock_id = ? ORDER BY trade_date DESC LIMIT 20")
    .all(stockId);
  const financial_metrics = db
    .prepare("SELECT * FROM financial_metrics WHERE stock_id = ? ORDER BY report_period DESC LIMIT 12")
    .all(stockId);
  const announcements = db
    .prepare("SELECT * FROM announcements WHERE stock_id = ? ORDER BY published_at DESC LIMIT 20")
    .all(stockId);
  const score = db
    .prepare("SELECT * FROM research_scores WHERE stock_id = ? ORDER BY score_date DESC, id DESC LIMIT 1")
    .get(stockId) as Record<string, unknown> | undefined;
  const notes = db.prepare("SELECT * FROM family_notes WHERE stock_id = ? ORDER BY created_at DESC").all(stockId);
  const reviews = db.prepare("SELECT * FROM review_records WHERE stock_id = ? ORDER BY review_date DESC").all(stockId);

  res.json({
    stock,
    daily_metrics,
    financial_metrics,
    announcements,
    score: score ? withParsedRiskTags(score) : null,
    notes,
    reviews
  });
});

app.post("/api/stocks/:code/notes", requireAuth, (req, res, next) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const stock = getUserStockByCode(user.id, req.params.code) as { id: number } | undefined;
    if (!stock) {
      res.status(404).json({ error: "Stock not found" });
      return;
    }
    const body = noteSchema.parse(req.body);
    const result = db
      .prepare("INSERT INTO family_notes (stock_id, author, content) VALUES (?, ?, ?)")
      .run(stock.id, body.author, body.content);
    res.status(201).json({ id: result.lastInsertRowid });
  } catch (error) {
    next(error);
  }
});

app.post("/api/stocks/:code/tradingagents-report", requireAuth, async (req, res, next) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const stock = getUserStockByCode(user.id, req.params.code) as { id: number; code: string; name?: string } | undefined;
    if (!stock) {
      res.status(404).json({ error: "Stock not found" });
      return;
    }

    const body = tradingAgentsReportSchema.parse(req.body ?? {});
    const job = createReportJob({
      userId: user.id,
      assetType: "a-share",
      code: stock.code,
      symbol: stock.code,
      displayName: stock.name,
      tradeDate: body.trade_date
    });
    res.status(202).json(job);
  } catch (error) {
    next(error);
  }
});

app.post("/api/tradingagents-report", requireAuth, async (req, res, next) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const body = globalTradingAgentsReportSchema.parse(req.body ?? {});
    const symbol = body.symbol.trim().toUpperCase();
    const job = createReportJob({
      userId: user.id,
      assetType: assetTypeForSymbol(symbol),
      code: symbol,
      symbol,
      tradeDate: body.trade_date
    });
    res.status(202).json(job);
  } catch (error) {
    next(error);
  }
});

app.get("/api/compare", (req, res) => {
  const codes = String(req.query.codes || "")
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean)
    .slice(0, 4);

  const rows = codes.map((code) => {
    const stock = getStockByCode(code) as Record<string, unknown> | undefined;
    if (!stock) return null;
    const stockId = Number(stock.id);
    return {
      stock,
      daily: db.prepare("SELECT * FROM daily_metrics WHERE stock_id = ? ORDER BY trade_date DESC LIMIT 1").get(stockId),
      financial: db
        .prepare("SELECT * FROM financial_metrics WHERE stock_id = ? ORDER BY report_period DESC LIMIT 1")
        .get(stockId),
      score: db
        .prepare("SELECT * FROM research_scores WHERE stock_id = ? ORDER BY score_date DESC, id DESC LIMIT 1")
        .get(stockId)
    };
  });

  res.json(rows.filter(Boolean));
});

app.get("/api/risks", (_req, res) => {
  const rows = db
    .prepare(
      `
      SELECT s.code, s.name, s.industry, rs.total_score, rs.risk_tags, rs.explanation, rs.created_at
      FROM stocks s
      LEFT JOIN research_scores rs ON rs.id = (
        SELECT id FROM research_scores
        WHERE stock_id = s.id
        ORDER BY score_date DESC, id DESC
        LIMIT 1
      )
      ORDER BY rs.total_score ASC, s.code ASC
    `
    )
    .all() as Array<Record<string, unknown>>;
  res.json(rows.map(withParsedRiskTags));
});

app.get("/api/reviews", (_req, res) => {
  const rows = db
    .prepare(
      `
      SELECT rr.*, s.code, s.name
      FROM review_records rr
      JOIN stocks s ON s.id = rr.stock_id
      ORDER BY rr.review_date DESC, rr.id DESC
    `
    )
    .all();
  res.json(rows);
});

app.post("/api/reviews", (req, res, next) => {
  try {
    const body = reviewSchema.parse(req.body);
    const result = db
      .prepare(
        `
        INSERT INTO review_records (stock_id, review_date, initial_judgement, observed_result, lessons)
        VALUES (@stock_id, @review_date, @initial_judgement, @observed_result, @lessons)
      `
      )
      .run(body);
    res.status(201).json({ id: result.lastInsertRowid });
  } catch (error) {
    next(error);
  }
});

app.get("/api/sync-logs", (_req, res) => {
  res.json(db.prepare("SELECT * FROM sync_logs ORDER BY started_at DESC LIMIT 50").all());
});

app.get("/api/data-quality", (_req, res) => {
  const rows = db
    .prepare(
      `
      SELECT
        s.code,
        s.name,
        s.industry,
        dm.trade_date AS latest_trade_date,
        dm.close_price,
        dm.source AS daily_source,
        fm.report_period AS latest_report_period,
        fm.source AS financial_source,
        (
          SELECT COUNT(*) FROM daily_metrics
          WHERE stock_id = s.id AND source LIKE '%demo%'
        ) AS demo_daily_rows,
        (
          SELECT COUNT(*) FROM financial_metrics
          WHERE stock_id = s.id AND source LIKE '%demo%'
        ) AS demo_financial_rows,
        (
          SELECT COUNT(*) FROM announcements
          WHERE stock_id = s.id AND source LIKE '%demo%'
        ) AS demo_announcement_rows
      FROM stocks s
      LEFT JOIN daily_metrics dm ON dm.id = (
        SELECT id FROM daily_metrics
        WHERE stock_id = s.id
        ORDER BY trade_date DESC
        LIMIT 1
      )
      LEFT JOIN financial_metrics fm ON fm.id = (
        SELECT id FROM financial_metrics
        WHERE stock_id = s.id
        ORDER BY report_period DESC
        LIMIT 1
      )
      ORDER BY s.code ASC
    `
    )
    .all() as Array<Record<string, unknown>>;

  const today = new Date().toISOString().slice(0, 10);
  res.json(
    rows.map((row) => {
      const issues = [];
      if (!row.industry || row.industry === "未识别行业") issues.push("行业未识别");
      if (!row.latest_trade_date || !row.close_price) issues.push("缺少真实行情");
      if (!row.latest_report_period) issues.push("缺少真实财务");
      if (Number(row.demo_daily_rows) || Number(row.demo_financial_rows) || Number(row.demo_announcement_rows)) {
        issues.push("存在演示数据");
      }
      if (row.latest_trade_date && String(row.latest_trade_date) < today.slice(0, 8) + "01") {
        issues.push("行情可能过旧");
      }
      return { ...row, issues };
    })
  );
});

app.post("/api/sync", requireAuth, async (req, res, next) => {
  const user = (req as AuthenticatedRequest).user;
  const startedAt = new Date().toISOString();
  const targetCode = typeof req.body?.code === "string" ? req.body.code : null;
  const syncType = targetCode ? "sync_one" : "sync_all";

  try {
    const codes = targetCode ? [targetCode] : listUserStockCodes(user.id).map((stock) => stock.code);
    if (!codes.length) {
      res.json({ synced: 0, message: "暂无自选股票" });
      return;
    }
    if (targetCode && !getUserStockByCode(user.id, targetCode)) {
      res.status(404).json({ error: "Stock not found" });
      return;
    }

    const payloads = await Promise.all(codes.map((code) => fetchPayloadByTasks(code)));
    const results = payloads.map(persistWorkerPayload);
    const finishedAt = new Date().toISOString();

    db.prepare(
      `
      INSERT INTO sync_logs (sync_type, target_code, status, started_at, finished_at, detail_json)
      VALUES (?, ?, 'success', ?, ?, ?)
    `
    ).run(syncType, targetCode, startedAt, finishedAt, JSON.stringify({ codes, count: results.length }));

    res.json({ synced: results.length, results });
  } catch (error) {
    const finishedAt = new Date().toISOString();
    db.prepare(
      `
      INSERT INTO sync_logs (sync_type, target_code, status, started_at, finished_at, error_message)
      VALUES (?, ?, 'failed', ?, ?, ?)
    `
    ).run(syncType, targetCode, startedAt, finishedAt, (error as Error).message);
    next(error);
  }
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof z.ZodError ? error.issues.map((issue) => issue.message).join("; ") : (error as Error).message;
  const statusCode = typeof (error as Error & { statusCode?: unknown }).statusCode === "number"
    ? Number((error as Error & { statusCode: number }).statusCode)
    : 400;
  res.status(statusCode).json({ error: message || "Unknown error" });
});

initializeReportJobQueue();

const server = app.listen(port, () => {
  console.log(`AlphaScope server listening on http://localhost:${port}`);
});

server.requestTimeout = requestTimeoutMs;
server.timeout = socketTimeoutMs;
