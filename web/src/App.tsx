import { useEffect, useState } from "react";
import {
  BarChart3,
  BookOpenText,
  Download,
  Home,
  RefreshCw,
  Search,
  Sparkles,
  Trash2
} from "lucide-react";
import { api } from "./api";
import type { StockDetail, StockListItem, TradingAgentsReport } from "./types";

type View = "home" | "a-share" | "us" | "crypto";

const navItems: Array<{ id: View; label: string; icon: typeof Home }> = [
  { id: "home", label: "首页", icon: Home },
  { id: "a-share", label: "A股", icon: BookOpenText },
  { id: "us", label: "美股", icon: BarChart3 },
  { id: "crypto", label: "加密", icon: Sparkles }
];

const tradingAgentIntroductions = [
  { name: "行情技术 Agent", role: "读取价格、成交量和技术指标，判断趋势、波动和关键价位。" },
  { name: "情绪 Agent", role: "整理市场讨论和情绪信号，提示过热、分歧或冷清状态。" },
  { name: "新闻 Agent", role: "归纳近期新闻、公告和宏观线索，找出可能影响交易的事件。" },
  { name: "基本面 Agent", role: "查看公司资料、财务质量和经营变化，形成基本面判断。" },
  { name: "多空研究员", role: "分别提出看多和看空理由，再由研究经理形成交易摘要。" },
  { name: "交易与风控 Agent", role: "把研究结论转成交易方案，并由风险团队复核最终决策。" }
];

const tradingAgentProgressSteps = [
  { title: "启动任务", detail: "校验资产符号、模型密钥和运行参数。", seconds: 8 },
  { title: "行情技术分析", detail: "Market Analyst 读取价格、成交量和技术指标。", seconds: 45 },
  { title: "情绪线索整理", detail: "Social/Sentiment Analyst 检查市场讨论和情绪信号。", seconds: 45 },
  { title: "新闻公告分析", detail: "News Analyst 汇总近期新闻、公告和宏观事件。", seconds: 45 },
  { title: "基本面分析", detail: "Fundamentals Analyst 研究财务、资料和经营质量。", seconds: 60 },
  { title: "多空辩论", detail: "看多、看空研究员互相辩论，研究经理提炼结论。", seconds: 55 },
  { title: "交易员方案", detail: "Trader Agent 生成交易动作、仓位思路和执行方案。", seconds: 35 },
  { title: "风险团队复核", detail: "激进、中性、保守风险角色复核交易方案。", seconds: 55 },
  { title: "最终决策", detail: "Portfolio Manager 汇总最终交易决策和中文报告。", seconds: 25 }
];

function formatNumber(value: unknown, digits = 2) {
  if (value === null || value === undefined || value === "") return "-";
  const number = Number(value);
  if (Number.isNaN(number)) return String(value);
  return number.toFixed(digits);
}

function safeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "").slice(0, 80) || "report";
}

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function formatElapsed(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes ? `${minutes}分${rest.toString().padStart(2, "0")}秒` : `${rest}秒`;
}

function getTradingAgentProgress(elapsedSeconds: number) {
  const totalSeconds = tradingAgentProgressSteps.reduce((sum, step) => sum + step.seconds, 0);
  let cumulative = 0;

  for (let index = 0; index < tradingAgentProgressSteps.length; index += 1) {
    cumulative += tradingAgentProgressSteps[index].seconds;
    if (elapsedSeconds < cumulative) {
      return {
        index,
        percent: Math.max(4, Math.min(95, Math.round((elapsedSeconds / totalSeconds) * 95))),
        step: tradingAgentProgressSteps[index]
      };
    }
  }

  return {
    index: tradingAgentProgressSteps.length - 1,
    percent: 95,
    step: {
      title: "等待最终返回",
      detail: "后台仍在整合模型输出，页面会在报告返回后自动展示。"
    }
  };
}

function Tags({ tags }: { tags?: string[] }) {
  if (!tags?.length) return <span className="text-slate-500">暂无明显标签</span>;
  return (
    <div className="flex flex-wrap gap-2">
      {tags.map((tag) => (
        <span key={tag} className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-800">
          {tag}
        </span>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line py-5">
      <h2 className="mb-3 text-lg font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}

export default function App() {
  const [view, setView] = useState<View>("home");
  const [stocks, setStocks] = useState<StockListItem[]>([]);
  const [selectedCode, setSelectedCode] = useState("");
  const [message, setMessage] = useState("");

  const loadStocks = async () => {
    const data = (await api.listStocks()) as StockListItem[];
    setStocks(data);
    if (!selectedCode && data[0]) setSelectedCode(data[0].code);
  };

  useEffect(() => {
    loadStocks().catch((error) => setMessage(error.message));
  }, []);

  return (
    <div className="min-h-screen bg-paper pb-20">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal text-ink">AlphaScope 全球资产研究台</h1>
            <p className="text-sm text-slate-600">Agent 研究、A股自选、美股报告和加密资产报告</p>
          </div>
          <nav className="flex flex-wrap gap-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = view === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setView(item.id)}
                  className={`inline-flex items-center gap-2 rounded border px-3 py-2 text-sm ${
                    active ? "border-accent bg-teal-50 text-accent" : "border-line bg-white text-slate-700"
                  }`}
                  title={item.label}
                >
                  <Icon size={16} />
                  {item.label}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-5">
        {message && (
          <div className="mb-4 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {message}
          </div>
        )}

        {view === "home" && <HomeView />}
        {view === "a-share" && (
          <AShareView
            stocks={stocks}
            selectedCode={selectedCode}
            setSelectedCode={setSelectedCode}
            reloadStocks={loadStocks}
          />
        )}
        {view === "us" && (
          <AssetReportPage
            title="美股 TradingAgents 报告"
            description="输入美股符号生成中文交易研究报告。"
            placeholder="例如 NVDA、AAPL、MSFT"
            examples={["NVDA", "AAPL", "MSFT", "TSLA"]}
          />
        )}
        {view === "crypto" && (
          <AssetReportPage
            title="加密资产 TradingAgents 报告"
            description="输入加密资产符号生成中文交易研究报告。"
            placeholder="例如 BTC-USD、ETH-USD、SOL-USD"
            examples={["BTC-USD", "ETH-USD", "SOL-USD", "BNB-USD"]}
          />
        )}
      </main>

      <footer className="fixed inset-x-0 bottom-0 border-t border-line bg-white px-4 py-3 text-center text-sm text-slate-700">
        AlphaScope 可生成多资产研究、交易观点、目标价和涨跌判断。模型结论可能错误或滞后，实际交易请自行确认数据并控制风险。
      </footer>
    </div>
  );
}

function HomeView() {
  return (
    <div>
      <section className="border-b border-line pb-5">
        <div className="mb-4">
          <h2 className="text-xl font-semibold text-ink">TradingAgents 角色简介</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            AlphaScope 用多个 Agent 接力完成研究：先看市场数据，再看情绪、新闻、基本面，最后经过多空辩论、交易员方案和风险复核。
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {tradingAgentIntroductions.map((agent) => (
            <div key={agent.name} className="rounded border border-line bg-white p-4">
              <div className="mb-2 text-sm font-semibold text-ink">{agent.name}</div>
              <p className="text-sm leading-6 text-slate-600">{agent.role}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function AssetReportPage({
  title,
  description,
  placeholder,
  examples
}: {
  title: string;
  description: string;
  placeholder: string;
  examples: string[];
}) {
  const [symbol, setSymbol] = useState("");
  const [report, setReport] = useState<TradingAgentsReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!loading) return;
    const timer = window.setInterval(() => {
      setElapsedSeconds((current) => current + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [loading]);

  const runReport = async (nextSymbol = symbol) => {
    const normalized = nextSymbol.trim().toUpperCase();
    if (!normalized) return;
    setSymbol(normalized);
    setLoading(true);
    setError("");
    setReport(null);
    setElapsedSeconds(0);
    try {
      setReport((await api.tradingAgentsSymbolReport(normalized)) as TradingAgentsReport);
    } catch (requestError) {
      setError((requestError as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const exportReport = () => {
    if (!report) return;
    const name = `${safeFileName(report.code)}-${safeFileName(report.trade_date)}.md`;
    downloadTextFile(name, buildTradingAgentsMarkdown(report));
  };

  return (
    <div>
      <section className="border-b border-line pb-5">
        <div className="mb-4">
          <h2 className="text-xl font-semibold text-ink">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">{description}</p>
        </div>
        <div className="flex flex-col gap-3 md:flex-row md:items-end">
          <label className="flex-1">
            <span className="mb-1 block text-sm font-medium text-slate-700">资产符号</span>
            <input
              value={symbol}
              onChange={(event) => setSymbol(event.target.value.toUpperCase().replace(/[^A-Z0-9._-]/g, "").slice(0, 32))}
              onKeyDown={(event) => {
                if (event.key === "Enter") runReport();
              }}
              placeholder={placeholder}
              className="w-full rounded border border-line bg-white px-3 py-2 outline-none focus:border-accent"
            />
          </label>
          <button
            disabled={loading || !symbol.trim()}
            onClick={() => runReport()}
            className="inline-flex items-center justify-center gap-2 rounded border border-accent bg-accent px-4 py-2 text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Sparkles size={16} />
            {loading ? "生成中" : "生成报告"}
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {examples.map((example) => (
            <button
              key={example}
              onClick={() => runReport(example)}
              className="rounded border border-line bg-white px-3 py-1.5 text-sm text-slate-700 hover:border-accent hover:text-accent"
            >
              {example}
            </button>
          ))}
        </div>
      </section>

      <section className="py-5">
        <div className="rounded border border-line bg-white p-4">
          {!report && !loading && !error && (
            <p className="text-sm leading-6 text-slate-600">输入符号后即可生成 TradingAgents 中文报告。</p>
          )}
          {loading && <TradingAgentsProgress elapsedSeconds={elapsedSeconds} />}
          {error && (
            <div className="rounded border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-700">
              {error}
            </div>
          )}
          {report && <TradingAgentsReportView report={report} onExport={exportReport} />}
        </div>
      </section>
    </div>
  );
}

function AShareView({
  stocks,
  selectedCode,
  setSelectedCode,
  reloadStocks
}: {
  stocks: StockListItem[];
  selectedCode: string;
  setSelectedCode: (code: string) => void;
  reloadStocks: () => Promise<void>;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<StockDetail | null>(null);
  const [report, setReport] = useState<TradingAgentsReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState("");
  const [reportElapsedSeconds, setReportElapsedSeconds] = useState(0);

  const loadDetail = async () => {
    if (!selectedCode) {
      setDetail(null);
      return;
    }
    setDetail((await api.getStock(selectedCode)) as StockDetail);
  };

  useEffect(() => {
    setReport(null);
    setReportError("");
    setReportElapsedSeconds(0);
    loadDetail().catch(() => setDetail(null));
  }, [selectedCode]);

  useEffect(() => {
    if (!reportLoading) return;
    const timer = window.setInterval(() => {
      setReportElapsedSeconds((current) => current + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [reportLoading]);

  const addStock = async () => {
    if (!/^\d{6}$/.test(code)) return;
    setBusy(true);
    try {
      await api.addStock(code);
      await api.sync(code);
      await reloadStocks();
      setSelectedCode(code);
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  const deleteStock = async (stock: StockListItem) => {
    const confirmed = window.confirm(`确定删除 ${stock.code} ${stock.name} 吗？相关数据也会一起删除。`);
    if (!confirmed) return;
    setBusy(true);
    try {
      await api.deleteStock(stock.code);
      await reloadStocks();
      if (selectedCode === stock.code) setSelectedCode("");
    } finally {
      setBusy(false);
    }
  };

  const syncSelected = async () => {
    if (!selectedCode) return;
    setBusy(true);
    try {
      await api.sync(selectedCode);
      await reloadStocks();
      await loadDetail();
    } finally {
      setBusy(false);
    }
  };

  const syncAll = async () => {
    setBusy(true);
    try {
      await api.sync();
      await reloadStocks();
      await loadDetail();
    } finally {
      setBusy(false);
    }
  };

  const runTradingAgents = async () => {
    if (!selectedCode) return;
    setReportLoading(true);
    setReportError("");
    setReportElapsedSeconds(0);
    try {
      setReport((await api.tradingAgentsReport(selectedCode)) as TradingAgentsReport);
    } catch (requestError) {
      setReportError((requestError as Error).message);
    } finally {
      setReportLoading(false);
    }
  };

  const exportReport = () => {
    if (!report || !detail) return;
    const name = `${safeFileName(report.code)}-${safeFileName(detail.stock.name || "TradingAgents")}-${safeFileName(report.trade_date)}.md`;
    downloadTextFile(name, buildTradingAgentsMarkdown(report, detail.stock.name));
  };

  return (
    <div>
      <section className="border-b border-line pb-5">
        <div className="mb-4">
          <h2 className="text-xl font-semibold text-ink">A股自选研究</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">维护 A 股自选池，查看本地数据、评分和 TradingAgents 中文报告。</p>
        </div>
        <div className="flex flex-col gap-3 md:flex-row md:items-end">
          <label className="flex-1">
            <span className="mb-1 block text-sm font-medium text-slate-700">A 股代码</span>
            <input
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              onKeyDown={(event) => {
                if (event.key === "Enter") addStock();
              }}
              placeholder="例如 600519"
              className="w-full rounded border border-line bg-white px-3 py-2 outline-none focus:border-accent"
            />
          </label>
          <button
            disabled={busy || !/^\d{6}$/.test(code)}
            onClick={addStock}
            className="inline-flex items-center justify-center gap-2 rounded border border-accent bg-accent px-4 py-2 text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Search size={16} />
            {busy ? "处理中" : "添加并同步"}
          </button>
          <button
            disabled={busy || !stocks.length}
            onClick={syncAll}
            className="inline-flex items-center justify-center gap-2 rounded border border-line bg-white px-4 py-2 text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw size={16} className={busy ? "animate-spin" : ""} />
            同步全部
          </button>
        </div>
      </section>

      <Section title="A股自选池">
        <div className="overflow-x-auto rounded border border-line bg-white">
          <table className="data-table">
            <thead>
              <tr>
                <th>代码</th>
                <th>名称</th>
                <th>行业</th>
                <th>收盘价</th>
                <th>PE_TTM</th>
                <th>PB</th>
                <th>研究评分</th>
                <th>风险标签</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {stocks.map((stock) => (
                <tr key={stock.code} className={selectedCode === stock.code ? "bg-teal-50" : "hover:bg-slate-50"}>
                  <td>
                    <button className="font-mono text-accent" onClick={() => setSelectedCode(stock.code)}>
                      {stock.code}
                    </button>
                  </td>
                  <td>{stock.name}</td>
                  <td>{stock.industry || "-"}</td>
                  <td>{formatNumber(stock.close_price)}</td>
                  <td>{formatNumber(stock.pe_ttm)}</td>
                  <td>{formatNumber(stock.pb)}</td>
                  <td>{stock.total_score ?? "-"}</td>
                  <td><Tags tags={stock.risk_tags} /></td>
                  <td>
                    <button
                      onClick={() => deleteStock(stock)}
                      className="inline-flex h-9 w-9 items-center justify-center rounded border border-line bg-white text-slate-600 hover:border-red-300 hover:bg-red-50 hover:text-red-700"
                      title="删除"
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
              {!stocks.length && (
                <tr>
                  <td colSpan={9} className="text-center text-slate-500">先添加一只 A 股开始研究。</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      {detail && (
        <>
          <Section title="当前自选详情">
            <div className="grid gap-4 md:grid-cols-5">
              <div className="rounded border border-line bg-white p-4 md:col-span-2">
                <h2 className="text-xl font-semibold">
                  {detail.stock.name} <span className="font-mono text-base text-slate-500">{detail.stock.code}</span>
                </h2>
                <p className="mt-2 text-sm text-slate-600">{detail.stock.company_profile}</p>
                <div className="mt-3 text-sm text-slate-700">市场：{detail.stock.market} ｜ 行业：{detail.stock.industry || "-"}</div>
              </div>
              <div className="rounded border border-line bg-white p-4 md:col-span-3">
                <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                  <Metric label="研究评分" value={detail.score?.total_score ?? "-"} />
                  <Metric label="行业前景" value={detail.score?.industry_outlook ?? "-"} />
                  <Metric label="竞争力" value={detail.score?.company_competitiveness ?? "-"} />
                  <Metric label="财务质量" value={detail.score?.financial_quality ?? "-"} />
                  <Metric label="风险控制" value={detail.score?.risk_control ?? "-"} />
                </div>
                <div className="mt-3"><Tags tags={detail.score?.risk_tags} /></div>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button onClick={syncSelected} disabled={busy} className="inline-flex items-center gap-2 rounded border border-line bg-white px-3 py-2 text-sm text-slate-700 disabled:opacity-50">
                <RefreshCw size={16} className={busy ? "animate-spin" : ""} />
                同步当前
              </button>
              <button onClick={runTradingAgents} disabled={reportLoading} className="inline-flex items-center gap-2 rounded border border-accent bg-accent px-3 py-2 text-sm text-white disabled:opacity-60">
                <Sparkles size={16} />
                {reportLoading ? "生成中" : "生成 TradingAgents 报告"}
              </button>
            </div>
          </Section>

          <Section title="TradingAgents 中文交易报告">
            <div className="rounded border border-line bg-white p-4">
              {!report && !reportLoading && !reportError && (
                <p className="text-sm leading-6 text-slate-600">点击上方按钮后生成 A 股中文交易研究报告。</p>
              )}
              {reportLoading && <TradingAgentsProgress elapsedSeconds={reportElapsedSeconds} />}
              {reportError && (
                <div className="rounded border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-700">
                  {reportError}
                </div>
              )}
              {report && <TradingAgentsReportView report={report} onExport={exportReport} />}
            </div>
          </Section>

          <Section title="最新数据">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="overflow-x-auto rounded border border-line bg-white">
                <table className="data-table">
                  <thead><tr><th>日期</th><th>收盘价</th><th>PE_TTM</th><th>PB</th><th>换手率</th><th>来源</th></tr></thead>
                  <tbody>{detail.daily_metrics.slice(0, 5).map((row) => (
                    <tr key={String(row.id)}><td>{row.trade_date}</td><td>{formatNumber(row.close_price)}</td><td>{formatNumber(row.pe_ttm)}</td><td>{formatNumber(row.pb)}</td><td>{formatNumber(row.turnover_rate)}</td><td>{row.source || "-"}</td></tr>
                  ))}</tbody>
                </table>
              </div>
              <div className="overflow-x-auto rounded border border-line bg-white">
                <table className="data-table">
                  <thead><tr><th>报告期</th><th>营收增速</th><th>净利增速</th><th>ROE</th><th>负债率</th><th>来源</th></tr></thead>
                  <tbody>{detail.financial_metrics.slice(0, 5).map((row) => (
                    <tr key={String(row.id)}><td>{row.report_period}</td><td>{formatNumber(row.revenue_growth)}%</td><td>{formatNumber(row.net_profit_growth)}%</td><td>{formatNumber(row.roe)}%</td><td>{formatNumber(row.debt_asset_ratio)}%</td><td>{row.source || "-"}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          </Section>

          <Section title="公告标题">
            <div className="overflow-x-auto rounded border border-line bg-white">
              <table className="data-table">
                <thead><tr><th>日期</th><th>类型</th><th>标题</th></tr></thead>
                <tbody>{detail.announcements.map((row) => (
                  <tr key={String(row.id)}><td>{row.published_at}</td><td>{row.announcement_type}</td><td>{row.title}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </Section>
        </>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="border-l-2 border-accent pl-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-lg font-semibold text-ink">{String(value)}</div>
    </div>
  );
}

function TradingAgentsReportView({ report, onExport }: { report: TradingAgentsReport; onExport: () => void }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 border-b border-line pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-wrap gap-3 text-sm text-slate-600">
          <span>代码：{report.code}</span>
          <span>行情符号：{report.symbol}</span>
          <span>分析日期：{report.trade_date}</span>
        </div>
        <button
          onClick={onExport}
          className="inline-flex items-center justify-center gap-2 rounded border border-line bg-white px-3 py-2 text-sm text-slate-700 hover:border-accent hover:text-accent"
          title="导出报告"
        >
          <Download size={16} />
          导出报告
        </button>
      </div>
      {Object.entries(report.sections).map(([key, value]) => (
        value ? (
          <article key={key} className="border-t border-line pt-4">
            <h3 className="mb-2 text-base font-semibold text-ink">{agentSectionTitle(key)}</h3>
            <p className="whitespace-pre-wrap text-sm leading-7 text-slate-700">{value}</p>
          </article>
        ) : null
      ))}
      <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">
        {report.risk_notice}
      </div>
    </div>
  );
}

function TradingAgentsProgress({ elapsedSeconds }: { elapsedSeconds: number }) {
  const progress = getTradingAgentProgress(elapsedSeconds);

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-semibold text-ink">当前阶段：{progress.step.title}</div>
            <p className="text-sm leading-6 text-slate-600">{progress.step.detail}</p>
          </div>
          <div className="text-sm text-slate-500">已用时 {formatElapsed(elapsedSeconds)}</div>
        </div>
        <div className="h-2 overflow-hidden rounded bg-slate-100">
          <div className="h-full rounded bg-accent transition-all duration-500" style={{ width: `${progress.percent}%` }} />
        </div>
        <p className="mt-2 text-xs text-slate-500">进度按 TradingAgents 的执行流程估算，报告返回后会自动切换为完整结果。</p>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        {tradingAgentProgressSteps.map((step, index) => {
          const status = index < progress.index ? "已完成" : index === progress.index ? "进行中" : "等待中";
          const active = index === progress.index;
          const done = index < progress.index;
          return (
            <div
              key={step.title}
              className={`rounded border p-3 text-sm ${
                active
                  ? "border-accent bg-teal-50"
                  : done
                    ? "border-emerald-200 bg-emerald-50"
                    : "border-line bg-white"
              }`}
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="font-medium text-ink">{step.title}</span>
                <span className={active ? "text-accent" : done ? "text-emerald-700" : "text-slate-500"}>{status}</span>
              </div>
              <p className="leading-6 text-slate-600">{step.detail}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function agentSectionTitle(key: string) {
  const map: Record<string, string> = {
    market_report: "行情与技术面",
    sentiment_report: "市场情绪",
    news_report: "新闻与公告线索",
    fundamentals_report: "基本面研究",
    investment_debate: "多空辩论",
    research_plan: "研究经理交易摘要",
    trader_plan: "交易员方案",
    risk_debate: "风险团队辩论",
    risk_review: "风险经理结论",
    final_trade_decision: "最终交易决策"
  };
  return map[key] || key;
}

function buildTradingAgentsMarkdown(report: TradingAgentsReport, stockName?: string) {
  const title = `${stockName ? `${stockName} ` : ""}${report.code} TradingAgents 中文交易报告`;
  const lines = [
    `# ${title}`,
    "",
    `- 代码：${report.code}`,
    `- 行情符号：${report.symbol}`,
    `- 分析日期：${report.trade_date}`,
    ""
  ];

  Object.entries(report.sections).forEach(([key, value]) => {
    if (!value) return;
    lines.push(`## ${agentSectionTitle(key)}`, "", String(value).trim(), "");
  });

  lines.push("## 风险提示", "", report.risk_notice);
  return `${lines.join("\n")}\n`;
}
