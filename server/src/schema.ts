export function initializeSchema(db: { exec: (sql: string) => void }) {
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS stocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      market TEXT NOT NULL,
      name TEXT NOT NULL,
      industry TEXT,
      company_profile TEXT,
      listing_date TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS daily_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stock_id INTEGER NOT NULL,
      trade_date TEXT NOT NULL,
      close_price REAL,
      pe REAL,
      pe_ttm REAL,
      pb REAL,
      ps REAL,
      dividend_yield REAL,
      market_cap REAL,
      turnover_rate REAL,
      source TEXT NOT NULL DEFAULT 'unknown',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(stock_id) REFERENCES stocks(id) ON DELETE CASCADE,
      UNIQUE(stock_id, trade_date)
    );

    CREATE TABLE IF NOT EXISTS financial_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stock_id INTEGER NOT NULL,
      report_period TEXT NOT NULL,
      revenue REAL,
      net_profit REAL,
      revenue_growth REAL,
      net_profit_growth REAL,
      gross_margin REAL,
      net_margin REAL,
      roe REAL,
      debt_asset_ratio REAL,
      operating_cash_flow REAL,
      source TEXT NOT NULL DEFAULT 'unknown',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(stock_id) REFERENCES stocks(id) ON DELETE CASCADE,
      UNIQUE(stock_id, report_period)
    );

    CREATE TABLE IF NOT EXISTS announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stock_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      published_at TEXT NOT NULL,
      announcement_type TEXT,
      url TEXT,
      source TEXT NOT NULL DEFAULT 'cninfo',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(stock_id) REFERENCES stocks(id) ON DELETE CASCADE,
      UNIQUE(stock_id, title, published_at)
    );

    CREATE TABLE IF NOT EXISTS research_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stock_id INTEGER NOT NULL,
      score_date TEXT NOT NULL,
      industry_outlook INTEGER NOT NULL,
      company_competitiveness INTEGER NOT NULL,
      financial_quality INTEGER NOT NULL,
      valuation_reasonableness INTEGER NOT NULL,
      risk_control INTEGER NOT NULL,
      total_score INTEGER NOT NULL,
      risk_tags TEXT NOT NULL DEFAULT '[]',
      explanation TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(stock_id) REFERENCES stocks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS family_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stock_id INTEGER NOT NULL,
      author TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(stock_id) REFERENCES stocks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS review_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stock_id INTEGER NOT NULL,
      review_date TEXT NOT NULL,
      initial_judgement TEXT NOT NULL,
      observed_result TEXT,
      lessons TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(stock_id) REFERENCES stocks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sync_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sync_type TEXT NOT NULL,
      target_code TEXT,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT NOT NULL,
      error_message TEXT,
      detail_json TEXT
    );
  `);
}
