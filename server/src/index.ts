import "dotenv/config";
import cors from "cors";
import express from "express";
import { z } from "zod";
import { db, getStockByCode, listStocks } from "./db.js";
import { runDataWorker } from "./dataWorker.js";
import { buildMockAiReport } from "./ai.js";
import { createResearchScore } from "./scoring.js";
import type { WorkerStockBasic, WorkerStockPayload } from "./types.js";
import type { WorkerAnnouncement, WorkerDailyMetric, WorkerFinancialMetric } from "./types.js";

const app = express();
const port = Number(process.env.PORT || 3001);

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
  res.json({ ok: true, service: "family-a-share-server" });
});

app.get("/api/stocks", (_req, res) => {
  res.json(listStocks().map((item) => withParsedRiskTags(item as Record<string, unknown>)));
});

app.post("/api/stocks", async (req, res, next) => {
  try {
    const { code } = addStockSchema.parse(req.body);
    const basic = await runDataWorker<WorkerStockBasic>("fetch_stock_basic", { code });
    const stock = upsertStock(basic);
    res.status(201).json(stock);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/stocks/:code", (req, res, next) => {
  try {
    const stock = getStockByCode(req.params.code) as { id: number } | undefined;
    if (!stock) {
      res.status(404).json({ error: "Stock not found" });
      return;
    }

    db.prepare("DELETE FROM stocks WHERE id = ?").run(stock.id);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/stocks/:code", (req, res) => {
  const stock = getStockByCode(req.params.code) as Record<string, unknown> | undefined;
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
  const ai_report = buildMockAiReport(stockId);

  res.json({
    stock,
    daily_metrics,
    financial_metrics,
    announcements,
    score: score ? withParsedRiskTags(score) : null,
    notes,
    reviews,
    ai_report
  });
});

app.post("/api/stocks/:code/notes", (req, res, next) => {
  try {
    const stock = getStockByCode(req.params.code) as { id: number } | undefined;
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

app.get("/api/compare", (req, res) => {
  const codes = String(req.query.codes || "")
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean)
    .slice(0, 3);

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

app.post("/api/sync", async (req, res, next) => {
  const startedAt = new Date().toISOString();
  const targetCode = typeof req.body?.code === "string" ? req.body.code : null;
  const syncType = targetCode ? "sync_one" : "sync_all";

  try {
    const codes = targetCode
      ? [targetCode]
      : (listStocks() as Array<{ code: string }>).map((stock) => stock.code);
    if (!codes.length) {
      res.json({ synced: 0, message: "暂无自选股票" });
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
  res.status(400).json({ error: message || "Unknown error" });
});

app.listen(port, () => {
  console.log(`family A-share server listening on http://localhost:${port}`);
});
