export type WorkerDailyMetric = {
  trade_date: string;
  close_price?: number;
  pe?: number;
  pe_ttm?: number;
  pb?: number;
  ps?: number;
  dividend_yield?: number;
  market_cap?: number;
  turnover_rate?: number;
  source?: string;
};

export type WorkerFinancialMetric = {
  report_period: string;
  revenue?: number;
  net_profit?: number;
  revenue_growth?: number;
  net_profit_growth?: number;
  gross_margin?: number;
  net_margin?: number;
  roe?: number;
  debt_asset_ratio?: number;
  operating_cash_flow?: number;
  source?: string;
};

export type WorkerAnnouncement = {
  title: string;
  published_at: string;
  announcement_type?: string;
  url?: string;
  source?: string;
};

export type WorkerStockBasic = {
  code: string;
  market: string;
  name: string;
  industry?: string;
  company_profile?: string;
  listing_date?: string;
};

export type WorkerStockPayload = {
  basic: WorkerStockBasic;
  daily_metrics: WorkerDailyMetric[];
  financial_metrics: WorkerFinancialMetric[];
  announcements: WorkerAnnouncement[];
};

export type AiReport = {
  one_sentence: string;
  financial_explanation: string;
  valuation_explanation: string;
  risk_explanation: string;
  peer_comparison: string;
  dad_version: string;
};

export type TradingAgentsReport = {
  code: string;
  symbol: string;
  trade_date: string;
  language: "Chinese";
  decision_signal?: unknown;
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
