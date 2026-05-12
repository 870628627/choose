export type StockListItem = {
  id: number;
  code: string;
  market: string;
  name: string;
  industry?: string;
  company_profile?: string;
  latest_trade_date?: string;
  close_price?: number;
  pe_ttm?: number;
  pb?: number;
  market_cap?: number;
  total_score?: number;
  risk_tags: string[];
};

export type StockDetail = {
  stock: StockListItem;
  daily_metrics: Array<Record<string, number | string | null>>;
  financial_metrics: Array<Record<string, number | string | null>>;
  announcements: Array<Record<string, number | string | null>>;
  score: (Record<string, number | string | string[] | null> & { risk_tags: string[] }) | null;
  notes: Array<{ id: number; author: string; content: string; created_at: string }>;
  reviews: Array<Record<string, number | string | null>>;
};

export type TradingAgentsReport = {
  code: string;
  symbol: string;
  trade_date: string;
  language: "Chinese";
  sections: {
    market_report?: string;
    sentiment_report?: string;
    news_report?: string;
    fundamentals_report?: string;
    investment_debate?: string;
    research_plan?: string;
    trader_plan?: string;
    risk_debate?: string;
    risk_review?: string;
    final_trade_decision?: string;
  };
  risk_notice: string;
};

export type SyncLog = {
  id: number;
  sync_type: string;
  target_code?: string;
  status: string;
  started_at: string;
  finished_at: string;
  error_message?: string;
  detail_json?: string;
};

export type DataQualityRow = {
  code: string;
  name: string;
  industry?: string;
  latest_trade_date?: string;
  close_price?: number;
  daily_source?: string;
  latest_report_period?: string;
  financial_source?: string;
  demo_daily_rows: number;
  demo_financial_rows: number;
  demo_announcement_rows: number;
  issues: string[];
};
