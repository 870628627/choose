import { db } from "./db.js";
import type { AiReport } from "./types.js";

const forbidden = ["推荐买入", "目标价", "必涨", "稳赚", "抄底", "牛股", "荐股"];

function sanitize(text: string) {
  return forbidden.reduce((current, word) => current.replaceAll(word, "[已过滤]"), text);
}

export function buildMockAiReport(stockId: number): AiReport {
  const stock = db.prepare("SELECT * FROM stocks WHERE id = ?").get(stockId) as Record<string, string> | undefined;
  const daily = db
    .prepare("SELECT * FROM daily_metrics WHERE stock_id = ? ORDER BY trade_date DESC LIMIT 1")
    .get(stockId) as Record<string, number | string> | undefined;
  const financial = db
    .prepare("SELECT * FROM financial_metrics WHERE stock_id = ? ORDER BY report_period DESC LIMIT 1")
    .get(stockId) as Record<string, number | string> | undefined;
  const score = db
    .prepare("SELECT * FROM research_scores WHERE stock_id = ? ORDER BY score_date DESC, id DESC LIMIT 1")
    .get(stockId) as Record<string, number | string> | undefined;
  const announcements = db
    .prepare("SELECT title FROM announcements WHERE stock_id = ? ORDER BY published_at DESC LIMIT 5")
    .all(stockId) as Array<{ title: string }>;

  const riskTags = score?.risk_tags ? JSON.parse(String(score.risk_tags)) as string[] : [];
  const name = stock?.name || "该公司";
  const industry = stock?.industry || "未识别行业";
  const pe = Number(daily?.pe_ttm ?? daily?.pe ?? 0);
  const pb = Number(daily?.pb ?? 0);
  const revenueGrowth = Number(financial?.revenue_growth ?? 0);
  const profitGrowth = Number(financial?.net_profit_growth ?? 0);
  const roe = Number(financial?.roe ?? 0);

  const report: AiReport = {
    one_sentence: `${name}属于${industry}，当前解释仅基于已入库的公司资料、估值、财务指标和公告标题。`,
    financial_explanation: `最近一期营收增速为${revenueGrowth.toFixed(1)}%，净利润增速为${profitGrowth.toFixed(
      1
    )}%，ROE 为${roe.toFixed(1)}%；这些数字用于观察经营质量和盈利效率。`,
    valuation_explanation: `最近入库 PE_TTM 约为${pe.toFixed(1)}，PB 约为${pb.toFixed(
      1
    )}；估值解释只描述当前指标高低，不代表未来涨跌判断。`,
    risk_explanation: riskTags.length
      ? `系统根据数据和公告标题识别到：${riskTags.join("、")}。近期公告包括：${announcements
          .map((item) => item.title)
          .join("；")}。`
      : `系统暂未根据当前入库数据识别到明显风险标签，仍需继续跟踪公告和财务变化。`,
    peer_comparison: `同行对比页会用同一套字段横向比较收盘价、PE_TTM、PB、ROE、净利润增速和研究评分，避免只看单一指标。`,
    dad_version: `可以把它理解成一本自动更新的小账本：先看公司做什么，再看赚钱能力、价格贵不贵、有没有风险提示，最后把自己的想法记下来以后复盘。`
  };

  return Object.fromEntries(Object.entries(report).map(([key, value]) => [key, sanitize(value)])) as AiReport;
}
