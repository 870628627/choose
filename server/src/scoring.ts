import { db } from "./db.js";

type MetricRow = Record<string, number | string | null>;
type AnnouncementRow = { title: string };

const clamp = (value: number, min = 0, max = 20) => Math.max(min, Math.min(max, Math.round(value)));

function hasKeyword(announcements: AnnouncementRow[], keywords: string[]) {
  return announcements.some((item) => keywords.some((keyword) => item.title.includes(keyword)));
}

export function calculateRiskTags(stockId: number) {
  const latestDaily = db
    .prepare("SELECT * FROM daily_metrics WHERE stock_id = ? ORDER BY trade_date DESC LIMIT 1")
    .get(stockId) as MetricRow | undefined;
  const financials = db
    .prepare("SELECT * FROM financial_metrics WHERE stock_id = ? ORDER BY report_period DESC LIMIT 2")
    .all(stockId) as MetricRow[];
  const announcements = db
    .prepare("SELECT title FROM announcements WHERE stock_id = ? ORDER BY published_at DESC LIMIT 30")
    .all(stockId) as AnnouncementRow[];

  const latestFinancial = financials[0];
  const previousFinancial = financials[1];
  const tags = new Set<string>();

  if (Number(latestDaily?.pe_ttm ?? latestDaily?.pe) > 50 || Number(latestDaily?.pb) > 8) {
    tags.add("估值偏高");
  }

  if (Number(latestFinancial?.operating_cash_flow) < 0) {
    tags.add("现金流风险");
  }

  if (Number(latestFinancial?.debt_asset_ratio) > 65) {
    tags.add("债务风险");
  }

  if (Number(latestFinancial?.revenue_growth) < 0 || Number(latestFinancial?.net_profit_growth) < 0) {
    tags.add("业绩下滑");
  }

  if (
    previousFinancial &&
    Number(latestFinancial?.roe) > 0 &&
    Number(previousFinancial?.roe) > 0 &&
    Number(latestFinancial?.roe) + 2 < Number(previousFinancial?.roe)
  ) {
    tags.add("ROE下降");
  }

  if (hasKeyword(announcements, ["减持"])) tags.add("减持风险");
  if (hasKeyword(announcements, ["诉讼", "仲裁"])) tags.add("诉讼风险");
  if (hasKeyword(announcements, ["监管", "处罚", "问询", "立案", "警示"])) tags.add("监管风险");
  if (hasKeyword(announcements, ["商誉", "减值"])) tags.add("商誉风险");
  if (hasKeyword(announcements, ["业绩预告修正", "业绩变脸", "预亏", "亏损"])) tags.add("业绩变脸风险");

  return Array.from(tags);
}

export function createResearchScore(stockId: number) {
  const latestDaily = db
    .prepare("SELECT * FROM daily_metrics WHERE stock_id = ? ORDER BY trade_date DESC LIMIT 1")
    .get(stockId) as MetricRow | undefined;
  const latestFinancial = db
    .prepare("SELECT * FROM financial_metrics WHERE stock_id = ? ORDER BY report_period DESC LIMIT 1")
    .get(stockId) as MetricRow | undefined;
  const stock = db.prepare("SELECT * FROM stocks WHERE id = ?").get(stockId) as MetricRow | undefined;
  const riskTags = calculateRiskTags(stockId);

  const growth = Number(latestFinancial?.revenue_growth ?? 0);
  const profitGrowth = Number(latestFinancial?.net_profit_growth ?? 0);
  const roe = Number(latestFinancial?.roe ?? 0);
  const netMargin = Number(latestFinancial?.net_margin ?? 0);
  const debt = Number(latestFinancial?.debt_asset_ratio ?? 0);
  const cashFlow = Number(latestFinancial?.operating_cash_flow ?? 0);
  const peTtm = Number(latestDaily?.pe_ttm ?? latestDaily?.pe ?? 0);
  const pb = Number(latestDaily?.pb ?? 0);

  const industry_outlook = clamp(12 + Math.min(5, growth / 5));
  const company_competitiveness = clamp(10 + Math.min(6, roe / 4) + Math.min(4, netMargin / 8));
  const financial_quality = clamp(9 + Math.min(5, profitGrowth / 6) + Math.min(4, roe / 5) + (cashFlow > 0 ? 2 : -3));
  const valuation_reasonableness = clamp(20 - Math.max(0, peTtm - 25) / 2 - Math.max(0, pb - 4) * 2);
  const risk_control = clamp(20 - riskTags.length * 2 - Math.max(0, debt - 50) / 5);
  const total_score =
    industry_outlook + company_competitiveness + financial_quality + valuation_reasonableness + risk_control;

  const explanation = `${String(stock?.name ?? "该公司")}研究评分基于库内估值、财务和公告标题自动计算；当前风险标签为${
    riskTags.length ? riskTags.join("、") : "暂无明显标签"
  }。`;

  const row = {
    stock_id: stockId,
    score_date: new Date().toISOString().slice(0, 10),
    industry_outlook,
    company_competitiveness,
    financial_quality,
    valuation_reasonableness,
    risk_control,
    total_score,
    risk_tags: JSON.stringify(riskTags),
    explanation
  };

  db.prepare(
    `
      INSERT INTO research_scores (
        stock_id, score_date, industry_outlook, company_competitiveness, financial_quality,
        valuation_reasonableness, risk_control, total_score, risk_tags, explanation
      ) VALUES (
        @stock_id, @score_date, @industry_outlook, @company_competitiveness, @financial_quality,
        @valuation_reasonableness, @risk_control, @total_score, @risk_tags, @explanation
      )
    `
  ).run(row);

  return row;
}
