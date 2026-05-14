function tryExec(db: { exec: (sql: string) => void }, sql: string, ignoredMessagePart: string) {
  try {
    db.exec(sql);
  } catch (error) {
    if (!String((error as Error).message).includes(ignoredMessagePart)) {
      throw error;
    }
  }
}

export function initializeSchema(db: { exec: (sql: string) => void }) {
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      email TEXT,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS trading_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      asset_type TEXT NOT NULL,
      symbol TEXT NOT NULL,
      display_name TEXT,
      trade_date TEXT NOT NULL,
      report_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_auth_sessions_token_hash ON auth_sessions(token_hash);
    CREATE INDEX IF NOT EXISTS idx_trading_reports_user_created ON trading_reports(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_trading_reports_user_asset_created ON trading_reports(user_id, asset_type, created_at DESC);

    CREATE TABLE IF NOT EXISTS report_showcase (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id INTEGER NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(report_id) REFERENCES trading_reports(id) ON DELETE CASCADE,
      FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_report_showcase_order ON report_showcase(sort_order, created_at DESC);

    CREATE TABLE IF NOT EXISTS report_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      asset_type TEXT NOT NULL,
      code TEXT NOT NULL,
      symbol TEXT NOT NULL,
      display_name TEXT,
      trade_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      progress_percent INTEGER NOT NULL DEFAULT 0,
      current_stage TEXT NOT NULL DEFAULT '排队中',
      error TEXT,
      report_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      started_at TEXT,
      completed_at TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(report_id) REFERENCES trading_reports(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_report_jobs_user_created ON report_jobs(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_report_jobs_user_status_created ON report_jobs(user_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_report_jobs_status_created ON report_jobs(status, created_at ASC);

    CREATE TABLE IF NOT EXISTS report_job_sections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      section_key TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      content TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      started_at TEXT,
      completed_at TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(job_id) REFERENCES report_jobs(id) ON DELETE CASCADE,
      UNIQUE(job_id, section_key)
    );

    CREATE INDEX IF NOT EXISTS idx_report_job_sections_job_order ON report_job_sections(job_id, sort_order);

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

    CREATE TABLE IF NOT EXISTS user_stocks (
      user_id INTEGER NOT NULL,
      stock_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id, stock_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(stock_id) REFERENCES stocks(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_user_stocks_user_created ON user_stocks(user_id, created_at DESC);

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

  tryExec(db, "ALTER TABLE users ADD COLUMN email TEXT", "duplicate column");
  tryExec(db, "ALTER TABLE users ADD COLUMN account_level TEXT NOT NULL DEFAULT 'regular'", "duplicate column");
  tryExec(db, "ALTER TABLE users ADD COLUMN admin_role TEXT NOT NULL DEFAULT 'none'", "duplicate column");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)");
  db.exec("UPDATE users SET email = username WHERE email IS NULL AND username LIKE '%@%'");
  db.exec("UPDATE users SET account_level = 'regular' WHERE account_level IS NULL OR account_level NOT IN ('regular', 'vip')");
  db.exec("UPDATE users SET admin_role = 'none' WHERE admin_role IS NULL OR admin_role != 'super_admin'");
  db.exec(`
    UPDATE users
    SET admin_role = 'super_admin',
        account_level = 'vip',
        updated_at = CURRENT_TIMESTAMP
    WHERE lower(coalesce(email, username)) = '870628627@qq.com'
  `);
}
