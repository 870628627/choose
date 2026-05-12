import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeSchema } from "./schema.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const databasePath = process.env.DATABASE_PATH
  ? path.resolve(process.cwd(), process.env.DATABASE_PATH)
  : path.resolve(__dirname, "../data/app.db");

mkdirSync(path.dirname(databasePath), { recursive: true });

export const db = new DatabaseSync(databasePath);

initializeSchema(db);
purgeDemoData();

export function getStockByCode(code: string) {
  return db.prepare("SELECT * FROM stocks WHERE code = ?").get(code);
}

export function getUserStockByCode(userId: number, code: string) {
  return db
    .prepare(
      `
      SELECT s.*
      FROM stocks s
      JOIN user_stocks us ON us.stock_id = s.id
      WHERE us.user_id = ? AND s.code = ?
      LIMIT 1
    `
    )
    .get(userId, code);
}

export function getStockById(id: number) {
  return db.prepare("SELECT * FROM stocks WHERE id = ?").get(id);
}

export function addUserStock(userId: number, stockId: number) {
  db.prepare("INSERT OR IGNORE INTO user_stocks (user_id, stock_id) VALUES (?, ?)").run(userId, stockId);
}

export function removeUserStock(userId: number, stockId: number) {
  db.prepare("DELETE FROM user_stocks WHERE user_id = ? AND stock_id = ?").run(userId, stockId);
}

export function listUserStockCodes(userId: number) {
  return db
    .prepare(
      `
      SELECT s.code
      FROM stocks s
      JOIN user_stocks us ON us.stock_id = s.id
      WHERE us.user_id = ?
      ORDER BY us.created_at DESC
    `
    )
    .all(userId) as Array<{ code: string }>;
}

export function listStocks(userId?: number) {
  if (userId) {
    return db
      .prepare(
        `
        SELECT
          s.*,
          dm.trade_date AS latest_trade_date,
          dm.close_price,
          dm.pe_ttm,
          dm.pb,
          dm.market_cap,
          rs.total_score,
          rs.risk_tags
        FROM stocks s
        JOIN user_stocks us ON us.stock_id = s.id
        LEFT JOIN daily_metrics dm ON dm.id = (
          SELECT id FROM daily_metrics
          WHERE stock_id = s.id
          ORDER BY trade_date DESC
          LIMIT 1
        )
        LEFT JOIN research_scores rs ON rs.id = (
          SELECT id FROM research_scores
          WHERE stock_id = s.id
          ORDER BY score_date DESC, id DESC
          LIMIT 1
        )
        WHERE us.user_id = ?
        ORDER BY us.created_at DESC, s.updated_at DESC
      `
      )
      .all(userId);
  }

  return db
    .prepare(
      `
      SELECT
        s.*,
        dm.trade_date AS latest_trade_date,
        dm.close_price,
        dm.pe_ttm,
        dm.pb,
        dm.market_cap,
        rs.total_score,
        rs.risk_tags
      FROM stocks s
      LEFT JOIN daily_metrics dm ON dm.id = (
        SELECT id FROM daily_metrics
        WHERE stock_id = s.id
        ORDER BY trade_date DESC
        LIMIT 1
      )
      LEFT JOIN research_scores rs ON rs.id = (
        SELECT id FROM research_scores
        WHERE stock_id = s.id
        ORDER BY score_date DESC, id DESC
        LIMIT 1
      )
      ORDER BY s.updated_at DESC, s.created_at DESC
    `
    )
    .all();
}

function purgeDemoData() {
  if (["1", "true", "yes"].includes(String(process.env.DATA_ALLOW_DEMO || "").toLowerCase())) {
    return;
  }

  db.exec(`
    DELETE FROM daily_metrics WHERE source LIKE '%demo%';
    DELETE FROM financial_metrics WHERE source LIKE '%demo%';
    DELETE FROM announcements WHERE source LIKE '%demo%';
    DELETE FROM research_scores;
  `);
}
