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
  account_level: "regular" | "vip";
  is_super_admin: boolean;
};

export type AuthSession = {
  token: string;
  user: AuthUser;
};

export type AdminUser = {
  id: number;
  email: string;
  display_name: string;
  account_level: "regular" | "vip";
  is_super_admin: boolean;
  created_at: string;
  updated_at: string;
  last_seen_at?: string;
  report_count: number;
  active_job_count: number;
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

export type ReportSummary = Omit<ReportRecord, "report"> & {
  report_size?: number;
};

export type ShowcaseReportRecord = ReportRecord & {
  owner_email?: string;
  is_showcased: boolean;
  showcase_id?: number | null;
  showcased_at?: string;
};

export type ReportJobSection = {
  section_key: keyof TradingAgentsReport["sections"] | string;
  title: string;
  status: "pending" | "running" | "completed" | "failed" | string;
  content: string;
  sort_order: number;
  started_at?: string;
  completed_at?: string;
  updated_at?: string;
};

export type ReportJob = {
  id: number;
  asset_type: ReportRecord["asset_type"];
  code: string;
  symbol: string;
  display_name?: string;
  trade_date: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress_percent: number;
  current_stage: string;
  error?: string;
  report_id?: number | null;
  queue_position: number;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  updated_at: string;
  sections: ReportJobSection[];
  report_record?: ReportRecord | null;
};
