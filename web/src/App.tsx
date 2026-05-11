import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  BookOpenText,
  FileClock,
  Home,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2
} from "lucide-react";
import { api } from "./api";
import type { StockDetail, StockListItem, SyncLog } from "./types";

type View = "home" | "detail" | "compare" | "risks" | "reviews" | "sync";

const navItems: Array<{ id: View; label: string; icon: typeof Home }> = [
  { id: "home", label: "首页", icon: Home },
  { id: "detail", label: "股票详情", icon: BookOpenText },
  { id: "compare", label: "股票对比", icon: BarChart3 },
  { id: "risks", label: "风险排雷", icon: ShieldAlert },
  { id: "reviews", label: "复盘", icon: FileClock },
  { id: "sync", label: "同步管理", icon: RefreshCw }
];

function formatNumber(value: unknown, digits = 2) {
  if (value === null || value === undefined || value === "") return "-";
  const number = Number(value);
  if (Number.isNaN(number)) return String(value);
  return number.toFixed(digits);
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
            <h1 className="text-2xl font-semibold tracking-normal text-ink">A股研究</h1>
            <p className="text-sm text-slate-600">自动数据、研究评分、风险标签和复盘</p>
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

        {view === "home" && <HomeView stocks={stocks} reload={loadStocks} openDetail={(code) => { setSelectedCode(code); setView("detail"); }} />}
        {view === "detail" && (
          <DetailView stocks={stocks} selectedCode={selectedCode} setSelectedCode={setSelectedCode} reloadStocks={loadStocks} />
        )}
        {view === "compare" && <CompareView stocks={stocks} />}
        {view === "risks" && <RisksView />}
        {view === "reviews" && <ReviewsView stocks={stocks} />}
        {view === "sync" && <SyncView reloadStocks={loadStocks} />}
      </main>

      <footer className="fixed inset-x-0 bottom-0 border-t border-line bg-white px-4 py-3 text-center text-sm text-slate-700">
        本工具仅用于家庭自用的股票信息整理、研究对比和复盘，不构成任何投资建议。股市有风险，投资需谨慎。
      </footer>
    </div>
  );
}

function HomeView({
  stocks,
  reload,
  openDetail
}: {
  stocks: StockListItem[];
  reload: () => Promise<void>;
  openDetail: (code: string) => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const addStock = async () => {
    if (!/^\d{6}$/.test(code)) return;
    setBusy(true);
    try {
      await api.addStock(code);
      await api.sync(code);
      await reload();
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  const deleteStock = async (stock: StockListItem) => {
    const confirmed = window.confirm(`确定删除 ${stock.code} ${stock.name} 吗？相关数据、笔记和复盘记录也会一起删除。`);
    if (!confirmed) return;
    setBusy(true);
    try {
      await api.deleteStock(stock.code);
      await reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="mb-5 flex flex-col gap-3 border-b border-line pb-5 md:flex-row md:items-end">
        <label className="flex-1">
          <span className="mb-1 block text-sm font-medium text-slate-700">股票代码</span>
          <input
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
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
      </div>

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
              <tr key={stock.code} className="hover:bg-slate-50">
                <td>
                  <button className="font-mono text-accent" onClick={() => openDetail(stock.code)}>
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
                <td colSpan={9} className="text-center text-slate-500">先添加一只股票开始研究。</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DetailView({
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
  const [detail, setDetail] = useState<StockDetail | null>(null);
  const [author, setAuthor] = useState("我");
  const [content, setContent] = useState("");

  const loadDetail = async () => {
    if (!selectedCode) return;
    setDetail((await api.getStock(selectedCode)) as StockDetail);
  };

  useEffect(() => {
    loadDetail().catch(() => setDetail(null));
  }, [selectedCode]);

  const addNote = async () => {
    if (!selectedCode || !content.trim()) return;
    await api.addNote(selectedCode, author, content);
    setContent("");
    await loadDetail();
  };

  const syncOne = async () => {
    if (!selectedCode) return;
    await api.sync(selectedCode);
    await reloadStocks();
    await loadDetail();
  };

  if (!stocks.length) return <p className="text-slate-600">请先在首页添加股票。</p>;

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center">
        <select
          value={selectedCode}
          onChange={(event) => setSelectedCode(event.target.value)}
          className="rounded border border-line bg-white px-3 py-2"
        >
          {stocks.map((stock) => (
            <option key={stock.code} value={stock.code}>{stock.code} {stock.name}</option>
          ))}
        </select>
        <button onClick={syncOne} className="inline-flex items-center gap-2 rounded border border-line bg-white px-3 py-2">
          <RefreshCw size={16} />
          同步当前股票
        </button>
      </div>

      {detail && (
        <>
          <div className="grid gap-4 md:grid-cols-5">
            <div className="rounded border border-line bg-white p-4 md:col-span-2">
              <h2 className="text-xl font-semibold">{detail.stock.name} <span className="font-mono text-base text-slate-500">{detail.stock.code}</span></h2>
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

          <Section title="模拟 AI 解释">
            <div className="grid gap-3 md:grid-cols-2">
              {Object.entries(detail.ai_report).map(([key, value]) => (
                <div key={key} className="rounded border border-line bg-white p-4 text-sm leading-6">
                  <div className="mb-1 font-semibold text-slate-700">{aiTitle(key)}</div>
                  <p>{value}</p>
                </div>
              ))}
            </div>
          </Section>

          <Section title="最新数据">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="overflow-x-auto rounded border border-line bg-white">
                <table className="data-table">
                  <thead><tr><th>日期</th><th>收盘价</th><th>PE_TTM</th><th>PB</th><th>换手率</th></tr></thead>
                  <tbody>{detail.daily_metrics.slice(0, 5).map((row) => (
                    <tr key={String(row.id)}><td>{row.trade_date}</td><td>{formatNumber(row.close_price)}</td><td>{formatNumber(row.pe_ttm)}</td><td>{formatNumber(row.pb)}</td><td>{formatNumber(row.turnover_rate)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
              <div className="overflow-x-auto rounded border border-line bg-white">
                <table className="data-table">
                  <thead><tr><th>报告期</th><th>营收增速</th><th>净利增速</th><th>ROE</th><th>负债率</th></tr></thead>
                  <tbody>{detail.financial_metrics.slice(0, 5).map((row) => (
                    <tr key={String(row.id)}><td>{row.report_period}</td><td>{formatNumber(row.revenue_growth)}%</td><td>{formatNumber(row.net_profit_growth)}%</td><td>{formatNumber(row.roe)}%</td><td>{formatNumber(row.debt_asset_ratio)}%</td></tr>
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

          <Section title="我和爸爸的笔记">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded border border-line bg-white p-4">
                <select value={author} onChange={(event) => setAuthor(event.target.value)} className="mb-3 w-full rounded border border-line px-3 py-2">
                  <option value="我">我</option>
                  <option value="爸爸">爸爸</option>
                </select>
                <textarea value={content} onChange={(event) => setContent(event.target.value)} rows={5} className="w-full rounded border border-line px-3 py-2" />
                <button onClick={addNote} className="mt-3 rounded border border-accent bg-accent px-4 py-2 text-white">保存笔记</button>
              </div>
              <div className="md:col-span-2">
                {detail.notes.map((note) => (
                  <div key={note.id} className="mb-3 rounded border border-line bg-white p-4">
                    <div className="mb-1 text-sm text-slate-500">{note.author} ｜ {note.created_at}</div>
                    <p className="whitespace-pre-wrap">{note.content}</p>
                  </div>
                ))}
              </div>
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

function aiTitle(key: string) {
  const map: Record<string, string> = {
    one_sentence: "公司一句话介绍",
    financial_explanation: "财务表现解释",
    valuation_explanation: "估值高低解释",
    risk_explanation: "主要风险解释",
    peer_comparison: "同行对比解释",
    dad_version: "爸爸版通俗解释"
  };
  return map[key] || key;
}

function CompareView({ stocks }: { stocks: StockListItem[] }) {
  const [codes, setCodes] = useState<string[]>([]);
  const [rows, setRows] = useState<Array<Record<string, any>>>([]);

  useEffect(() => {
    if (stocks.length && codes.length === 0) setCodes(stocks.slice(0, 2).map((stock) => stock.code));
  }, [stocks]);

  useEffect(() => {
    if (codes.length >= 2) api.compare(codes).then((data) => setRows(data as Array<Record<string, any>>));
  }, [codes.join(",")]);

  const toggle = (code: string) => {
    setCodes((current) => current.includes(code) ? current.filter((item) => item !== code) : [...current, code].slice(0, 3));
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        {stocks.map((stock) => (
          <label key={stock.code} className="inline-flex items-center gap-2 rounded border border-line bg-white px-3 py-2 text-sm">
            <input type="checkbox" checked={codes.includes(stock.code)} onChange={() => toggle(stock.code)} />
            {stock.code} {stock.name}
          </label>
        ))}
      </div>
      <div className="overflow-x-auto rounded border border-line bg-white">
        <table className="data-table">
          <thead><tr><th>字段</th>{rows.map((row) => <th key={row.stock.code}>{row.stock.name}</th>)}</tr></thead>
          <tbody>
            {[
              ["行业", (row: any) => row.stock.industry],
              ["收盘价", (row: any) => formatNumber(row.daily?.close_price)],
              ["PE_TTM", (row: any) => formatNumber(row.daily?.pe_ttm)],
              ["PB", (row: any) => formatNumber(row.daily?.pb)],
              ["ROE", (row: any) => `${formatNumber(row.financial?.roe)}%`],
              ["净利润增速", (row: any) => `${formatNumber(row.financial?.net_profit_growth)}%`],
              ["研究评分", (row: any) => row.score?.total_score ?? "-"]
            ].map(([label, getter]) => (
              <tr key={String(label)}><td className="font-medium">{String(label)}</td>{rows.map((row) => <td key={row.stock.code}>{(getter as (row: any) => string)(row)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RisksView() {
  const [rows, setRows] = useState<StockListItem[]>([]);
  useEffect(() => {
    api.risks().then((data) => setRows(data as StockListItem[]));
  }, []);
  return (
    <div className="overflow-x-auto rounded border border-line bg-white">
      <table className="data-table">
        <thead><tr><th>代码</th><th>名称</th><th>行业</th><th>研究评分</th><th>风险标签</th><th>说明</th></tr></thead>
        <tbody>{rows.map((row) => (
          <tr key={row.code}>
            <td className="font-mono">{row.code}</td><td>{row.name}</td><td>{row.industry}</td><td>{row.total_score ?? "-"}</td><td><Tags tags={row.risk_tags} /></td><td>{(row as any).explanation}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function ReviewsView({ stocks }: { stocks: StockListItem[] }) {
  const [rows, setRows] = useState<Array<Record<string, any>>>([]);
  const [stockId, setStockId] = useState<number | "">("");
  const [initial, setInitial] = useState("");
  const [result, setResult] = useState("");
  const [lessons, setLessons] = useState("");

  const load = () => api.reviews().then((data) => setRows(data as Array<Record<string, any>>));
  useEffect(() => { load(); }, []);
  useEffect(() => { if (!stockId && stocks[0]) setStockId(stocks[0].id); }, [stocks]);

  const save = async () => {
    if (!stockId || !initial.trim()) return;
    await api.addReview({
      stock_id: Number(stockId),
      review_date: new Date().toISOString().slice(0, 10),
      initial_judgement: initial,
      observed_result: result,
      lessons
    });
    setInitial("");
    setResult("");
    setLessons("");
    await load();
  };

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="rounded border border-line bg-white p-4">
        <select value={stockId} onChange={(event) => setStockId(Number(event.target.value))} className="mb-3 w-full rounded border border-line px-3 py-2">
          {stocks.map((stock) => <option key={stock.id} value={stock.id}>{stock.code} {stock.name}</option>)}
        </select>
        <textarea value={initial} onChange={(event) => setInitial(event.target.value)} rows={4} placeholder="当时判断" className="mb-3 w-full rounded border border-line px-3 py-2" />
        <textarea value={result} onChange={(event) => setResult(event.target.value)} rows={3} placeholder="后续结果" className="mb-3 w-full rounded border border-line px-3 py-2" />
        <textarea value={lessons} onChange={(event) => setLessons(event.target.value)} rows={3} placeholder="复盘心得" className="w-full rounded border border-line px-3 py-2" />
        <button onClick={save} className="mt-3 rounded border border-accent bg-accent px-4 py-2 text-white">保存复盘</button>
      </div>
      <div className="lg:col-span-2">
        {rows.map((row) => (
          <div key={row.id} className="mb-3 rounded border border-line bg-white p-4">
            <div className="mb-2 text-sm text-slate-500">{row.review_date} ｜ {row.code} {row.name}</div>
            <p className="whitespace-pre-wrap"><span className="font-medium">当时判断：</span>{row.initial_judgement}</p>
            {row.observed_result && <p className="mt-2 whitespace-pre-wrap"><span className="font-medium">后续结果：</span>{row.observed_result}</p>}
            {row.lessons && <p className="mt-2 whitespace-pre-wrap"><span className="font-medium">复盘心得：</span>{row.lessons}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

function SyncView({ reloadStocks }: { reloadStocks: () => Promise<void> }) {
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [busy, setBusy] = useState(false);
  const load = () => api.syncLogs().then((data) => setLogs(data as SyncLog[]));
  useEffect(() => { load(); }, []);

  const syncAll = async () => {
    setBusy(true);
    try {
      await api.sync();
      await reloadStocks();
      await load();
    } finally {
      setBusy(false);
    }
  };

  const nextHint = useMemo(() => "已预留每天 18:30 自动同步扩展点，MVP 先使用手动同步。", []);

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 border-b border-line pb-4 md:flex-row md:items-center md:justify-between">
        <div className="text-sm text-slate-600">{nextHint}</div>
        <button onClick={syncAll} disabled={busy} className="inline-flex items-center justify-center gap-2 rounded border border-accent bg-accent px-4 py-2 text-white disabled:opacity-50">
          <RefreshCw size={16} className={busy ? "animate-spin" : ""} />
          {busy ? "同步中" : "同步全部自选股"}
        </button>
      </div>
      <div className="overflow-x-auto rounded border border-line bg-white">
        <table className="data-table">
          <thead><tr><th>类型</th><th>目标</th><th>状态</th><th>开始</th><th>结束</th><th>错误</th></tr></thead>
          <tbody>{logs.map((log) => (
            <tr key={log.id}>
              <td>{log.sync_type}</td><td>{log.target_code || "全部"}</td><td>{log.status}</td><td>{log.started_at}</td><td>{log.finished_at}</td><td>{log.error_message || "-"}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}
