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
};

export type TradingAgentsReport = {
  record_id?: number;
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

export type AuthUser = {
  id: number;
  email: string;
  display_name: string;
};

export type AuthSession = {
  token: string;
  user: AuthUser;
};

export type ReportRecord = {
  id: number;
  asset_type: "a-share" | "us" | "crypto";
  symbol: string;
  display_name?: string;
  trade_date: string;
  created_at: string;
  report: TradingAgentsReport;
};
