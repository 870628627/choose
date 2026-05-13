import { type FormEvent, useEffect, useState } from "react";
import {
  Activity,
  BarChart3,
  BookOpenText,
  ChevronDown,
  Download,
  FileText,
  Home,
  LockKeyhole,
  LogIn,
  LogOut,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  User,
  UserPlus
} from "lucide-react";
import { api, getAuthToken, setAuthToken } from "./api";
import type { AuthSession, ReportJob, ReportRecord, StockDetail, StockListItem, TradingAgentsReport } from "./types";

type View = "home" | "a-share" | "us" | "crypto";

const navItems: Array<{ id: View; label: string; icon: typeof Home }> = [
  { id: "home", label: "首页", icon: Home },
  { id: "a-share", label: "A股", icon: BookOpenText },
  { id: "us", label: "美股", icon: BarChart3 },
  { id: "crypto", label: "加密", icon: Sparkles }
];

const assetTypeLabels: Record<ReportRecord["asset_type"], string> = {
  "a-share": "A股",
  us: "美股",
  crypto: "加密"
};

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

const progressStepSectionKeys = [
  "",
  "market_report",
  "sentiment_report",
  "news_report",
  "fundamentals_report",
  "investment_debate",
  "trader_plan",
  "risk_debate",
  "final_trade_decision"
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

function AuthLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#080b0f] px-4 text-slate-200">
      <div className="flex items-center gap-3 rounded border border-emerald-400/30 bg-white/5 px-4 py-3">
        <Activity size={18} className="animate-pulse text-emerald-300" />
        <span className="text-sm">正在连接 AlphaScope 交易台</span>
      </div>
    </div>
  );
}

function AuthShell({ onAuthenticated }: { onAuthenticated: (session: AuthSession) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const normalized = email.trim().toLowerCase();
      const session = mode === "login"
        ? await api.login(normalized, password)
        : await api.register(normalized, password);
      onAuthenticated(session);
    } catch (requestError) {
      setError((requestError as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#080b0f] text-slate-100">
      <div className="absolute inset-0 opacity-30" style={{
        backgroundImage:
          "linear-gradient(rgba(16,185,129,.18) 1px, transparent 1px), linear-gradient(90deg, rgba(56,189,248,.12) 1px, transparent 1px)",
        backgroundSize: "42px 42px"
      }} />
      <main className="relative mx-auto grid min-h-screen max-w-6xl gap-8 px-4 py-10 lg:grid-cols-[1.1fr_.9fr] lg:items-center">
        <section className="space-y-6">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-sm text-emerald-200">
              <ShieldCheck size={16} />
              私有报告库
            </div>
            <h1 className="text-4xl font-semibold tracking-normal text-white sm:text-5xl">AlphaScope 全球资产研究台</h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300">
              为 A股、美股和加密资产准备的多 Agent 研究工作台。每个账户拥有独立报告记录，登录后即可继续自己的研究线索。
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ["Market", "价格、成交量、技术结构"],
              ["Research", "新闻、情绪、基本面"],
              ["Execution", "交易方案、风控复核"]
            ].map(([label, value]) => (
              <div key={label} className="rounded border border-white/10 bg-white/[0.04] p-4">
                <div className="text-xs uppercase tracking-widest text-emerald-300">{label}</div>
                <div className="mt-2 text-sm leading-6 text-slate-300">{value}</div>
              </div>
            ))}
          </div>
          <div className="overflow-hidden rounded border border-white/10 bg-black/30">
            <div className="grid grid-cols-4 border-b border-white/10 px-4 py-2 text-xs uppercase tracking-widest text-slate-500">
              <span>Symbol</span>
              <span>Signal</span>
              <span>Risk</span>
              <span>Status</span>
            </div>
            {[
              ["NVDA", "Momentum", "Medium", "Reviewing"],
              ["600519", "Quality", "Low", "Ready"],
              ["BTC-USD", "Volatility", "High", "Watching"]
            ].map((row) => (
              <div key={row[0]} className="grid grid-cols-4 border-b border-white/5 px-4 py-3 text-sm last:border-b-0">
                <span className="font-mono text-cyan-200">{row[0]}</span>
                <span className="text-slate-300">{row[1]}</span>
                <span className={row[2] === "High" ? "text-amber-300" : row[2] === "Low" ? "text-emerald-300" : "text-slate-300"}>{row[2]}</span>
                <span className="text-slate-400">{row[3]}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded border border-white/10 bg-[#10151d]/95 p-5 shadow-2xl shadow-black/40">
          <div className="mb-5 flex rounded border border-white/10 bg-black/30 p-1">
            <button
              type="button"
              onClick={() => setMode("login")}
              className={`flex flex-1 items-center justify-center gap-2 rounded px-3 py-2 text-sm ${
                mode === "login" ? "bg-emerald-400 text-slate-950" : "text-slate-300"
              }`}
            >
              <LogIn size={16} />
              登录
            </button>
            <button
              type="button"
              onClick={() => setMode("register")}
              className={`flex flex-1 items-center justify-center gap-2 rounded px-3 py-2 text-sm ${
                mode === "register" ? "bg-emerald-400 text-slate-950" : "text-slate-300"
              }`}
            >
              <UserPlus size={16} />
              注册
            </button>
          </div>

          <form className="space-y-4" onSubmit={submit}>
            <label className="block">
              <span className="mb-1 flex items-center gap-2 text-sm text-slate-300"><User size={15} />邮箱</span>
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value.trim().slice(0, 254))}
                type="email"
                autoComplete="username"
                placeholder="trader@example.com"
                className="w-full rounded border border-white/10 bg-black/40 px-3 py-2 text-slate-100 outline-none focus:border-emerald-300"
              />
            </label>
            <label className="block">
              <span className="mb-1 flex items-center gap-2 text-sm text-slate-300"><LockKeyhole size={15} />密码</span>
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value.slice(0, 128))}
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                placeholder="至少 8 位"
                className="w-full rounded border border-white/10 bg-black/40 px-3 py-2 text-slate-100 outline-none focus:border-emerald-300"
              />
            </label>
            {error && (
              <div className="rounded border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm leading-6 text-red-200">
                {error}
              </div>
            )}
            <button
              disabled={busy || !email.includes("@") || password.length < 8}
              className="flex w-full items-center justify-center gap-2 rounded border border-emerald-300 bg-emerald-400 px-4 py-2.5 font-medium text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {mode === "login" ? <LogIn size={17} /> : <UserPlus size={17} />}
              {busy ? "处理中" : mode === "login" ? "进入交易台" : "创建账户"}
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}

export default function App() {
  const [view, setView] = useState<View>("home");
  const [session, setSession] = useState<AuthSession | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [stocks, setStocks] = useState<StockListItem[]>([]);
  const [selectedCode, setSelectedCode] = useState("");
  const [message, setMessage] = useState("");

  const loadStocks = async () => {
    const data = (await api.listStocks()) as StockListItem[];
    setStocks(data);
    if (!selectedCode && data[0]) setSelectedCode(data[0].code);
  };

  useEffect(() => {
    const token = getAuthToken();
    if (!token) {
      setAuthReady(true);
      return;
    }
    api.me()
      .then(({ user }) => setSession({ token, user }))
      .catch(() => {
        setAuthToken("");
        setSession(null);
      })
      .finally(() => setAuthReady(true));
  }, []);

  useEffect(() => {
    if (!session) return;
    loadStocks().catch((error) => setMessage(error.message));
  }, [session?.user.id]);

  const handleAuthenticated = (nextSession: AuthSession) => {
    setAuthToken(nextSession.token);
    setSession(nextSession);
    setMessage("");
  };

  const logout = async () => {
    try {
      await api.logout();
    } catch {
      // 本地清理仍然继续，避免网络抖动把用户困在当前会话。
    }
    setAuthToken("");
    setSession(null);
    setStocks([]);
    setSelectedCode("");
    setView("home");
  };

  if (!authReady) return <AuthLoading />;
  if (!session) return <AuthShell onAuthenticated={handleAuthenticated} />;

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
            <div className="flex items-center gap-2 rounded border border-line bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <User size={16} />
              {session.user.display_name}
            </div>
            <button
              onClick={logout}
              className="inline-flex items-center gap-2 rounded border border-line bg-white px-3 py-2 text-sm text-slate-700 hover:border-red-300 hover:bg-red-50 hover:text-red-700"
              title="退出登录"
            >
              <LogOut size={16} />
              退出
            </button>
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
            assetType="us"
            title="美股 TradingAgents 报告"
            description="输入美股符号生成中文交易研究报告。"
            placeholder="例如 NVDA、AAPL、MSFT"
            examples={["NVDA", "AAPL", "MSFT", "TSLA"]}
          />
        )}
        {view === "crypto" && (
          <AssetReportPage
            assetType="crypto"
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
  assetType,
  title,
  description,
  placeholder,
  examples
}: {
  assetType: ReportRecord["asset_type"];
  title: string;
  description: string;
  placeholder: string;
  examples: string[];
}) {
  const [symbol, setSymbol] = useState("");
  const [report, setReport] = useState<TradingAgentsReport | null>(null);
  const [job, setJob] = useState<ReportJob | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [historyVersion, setHistoryVersion] = useState(0);

  useEffect(() => {
    if (!loading) return;
    const timer = window.setInterval(() => {
      setElapsedSeconds((current) => current + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [loading]);

  useEffect(() => {
    if (!loading || !job) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const nextJob = await api.reportJob(job.id);
        if (cancelled) return;
        setJob(nextJob);
        if (nextJob.status === "completed") {
          setReport(nextJob.report_record?.report || null);
          setHistoryVersion((current) => current + 1);
          setLoading(false);
        } else if (nextJob.status === "failed") {
          setError(nextJob.error || "报告生成失败");
          setLoading(false);
        }
      } catch (requestError) {
        if (!cancelled) {
          setError((requestError as Error).message);
          setLoading(false);
        }
      }
    };
    poll();
    const timer = window.setInterval(poll, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [loading, job?.id]);

  const runReport = async (nextSymbol = symbol) => {
    const normalized = nextSymbol.trim().toUpperCase();
    if (!normalized) return;
    setSymbol(normalized);
    setLoading(true);
    setError("");
    setReport(null);
    setJob(null);
    setElapsedSeconds(0);
    try {
      const nextJob = await api.tradingAgentsSymbolReport(normalized);
      setJob(nextJob);
    } catch (requestError) {
      setError((requestError as Error).message);
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
          {loading && <TradingAgentsProgress elapsedSeconds={elapsedSeconds} job={job} />}
          {error && (
            <div className="rounded border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-700">
              {error}
            </div>
          )}
          {report && <TradingAgentsReportView report={report} onExport={exportReport} />}
        </div>
      </section>

      <ReportHistory assetType={assetType} refreshKey={historyVersion} />
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
  const [reportJob, setReportJob] = useState<ReportJob | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState("");
  const [reportElapsedSeconds, setReportElapsedSeconds] = useState(0);
  const [historyVersion, setHistoryVersion] = useState(0);

  const loadDetail = async () => {
    if (!selectedCode) {
      setDetail(null);
      return;
    }
    setDetail((await api.getStock(selectedCode)) as StockDetail);
  };

  useEffect(() => {
    setReport(null);
    setReportJob(null);
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

  useEffect(() => {
    if (!reportLoading || !reportJob) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const nextJob = await api.reportJob(reportJob.id);
        if (cancelled) return;
        setReportJob(nextJob);
        if (nextJob.status === "completed") {
          setReport(nextJob.report_record?.report || null);
          setHistoryVersion((current) => current + 1);
          setReportLoading(false);
        } else if (nextJob.status === "failed") {
          setReportError(nextJob.error || "报告生成失败");
          setReportLoading(false);
        }
      } catch (requestError) {
        if (!cancelled) {
          setReportError((requestError as Error).message);
          setReportLoading(false);
        }
      }
    };
    poll();
    const timer = window.setInterval(poll, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [reportLoading, reportJob?.id]);

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
    const confirmed = window.confirm(`确定从你的自选池删除 ${stock.code} ${stock.name} 吗？不会影响其他用户。`);
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
    setReport(null);
    setReportJob(null);
    setReportElapsedSeconds(0);
    try {
      const nextJob = await api.tradingAgentsReport(selectedCode);
      setReportJob(nextJob);
    } catch (requestError) {
      setReportError((requestError as Error).message);
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
        <div className="mt-3 grid gap-2 md:max-w-xl">
          <label>
            <span className="mb-1 block text-sm font-medium text-slate-700">选择要生成报告的自选股</span>
            <select
              value={selectedCode}
              onChange={(event) => setSelectedCode(event.target.value)}
              className="w-full rounded border border-line bg-white px-3 py-2 outline-none focus:border-accent"
              disabled={!stocks.length}
            >
              {!stocks.length && <option value="">先添加一只 A 股</option>}
              {stocks.map((stock) => (
                <option key={stock.code} value={stock.code}>
                  {stock.code} ｜ {stock.name}
                </option>
              ))}
            </select>
          </label>
          {selectedCode && (
            <p className="text-sm text-slate-600">当前报告对象：{selectedCode}。也可以在下方表格里点击代码或“选择”。</p>
          )}
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
                    <div className="flex gap-2">
                      <button
                        onClick={() => setSelectedCode(stock.code)}
                        className={`inline-flex items-center justify-center rounded border px-3 py-2 text-sm ${
                          selectedCode === stock.code
                            ? "border-accent bg-teal-50 text-accent"
                            : "border-line bg-white text-slate-600 hover:border-accent hover:text-accent"
                        }`}
                      >
                        {selectedCode === stock.code ? "已选择" : "选择"}
                      </button>
                      <button
                        onClick={() => deleteStock(stock)}
                        className="inline-flex h-9 w-9 items-center justify-center rounded border border-line bg-white text-slate-600 hover:border-red-300 hover:bg-red-50 hover:text-red-700"
                        title="删除"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
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
              {reportLoading && <TradingAgentsProgress elapsedSeconds={reportElapsedSeconds} job={reportJob} />}
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

      <ReportHistory assetType="a-share" refreshKey={historyVersion} />
    </div>
  );
}

function ReportHistory({
  assetType,
  refreshKey
}: {
  assetType: ReportRecord["asset_type"];
  refreshKey: number;
}) {
  const [records, setRecords] = useState<ReportRecord[]>([]);
  const [jobs, setJobs] = useState<ReportJob[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadRecords = async () => {
    setLoading(true);
    setError("");
    try {
      const [nextRecords, nextJobs] = await Promise.all([
        api.reports(assetType),
        api.reportJobs(assetType)
      ]);
      setRecords(nextRecords);
      setJobs(nextJobs.filter((job) => job.status !== "completed"));
      if (expandedId && !nextRecords.some((record) => record.id === expandedId)) {
        setExpandedId(null);
      }
    } catch (requestError) {
      setError((requestError as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRecords();
  }, [assetType, refreshKey]);

  useEffect(() => {
    if (!jobs.some((job) => job.status === "queued" || job.status === "running")) return;
    const timer = window.setInterval(() => {
      loadRecords();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [assetType, jobs]);

  const deleteRecord = async (record: ReportRecord) => {
    const confirmed = window.confirm(`确定删除 ${record.symbol} ${record.trade_date} 的报告记录吗？`);
    if (!confirmed) return;
    await api.deleteReport(record.id);
    setRecords((current) => current.filter((item) => item.id !== record.id));
    if (expandedId === record.id) setExpandedId(null);
  };

  const exportRecord = (record: ReportRecord) => {
    const label = record.display_name || record.symbol;
    const name = `${safeFileName(record.symbol)}-${safeFileName(label)}-${safeFileName(record.trade_date)}.md`;
    downloadTextFile(name, buildTradingAgentsMarkdown(record.report, record.display_name));
  };

  return (
    <Section title={`我的${assetTypeLabels[assetType]}报告记录`}>
      <div className="rounded border border-line bg-white">
        <div className="flex flex-col gap-2 border-b border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <FileText size={16} className="text-accent" />
            <span>{loading ? "正在刷新记录" : `共 ${records.length} 份报告`}</span>
          </div>
          <button
            onClick={loadRecords}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded border border-line bg-white px-3 py-2 text-sm text-slate-700 disabled:opacity-50"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            刷新
          </button>
        </div>
        {error && (
          <div className="m-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}
        {!loading && !records.length && !jobs.length && !error && (
          <div className="px-4 py-8 text-center text-sm text-slate-500">这个账户还没有生成过{assetTypeLabels[assetType]}报告。</div>
        )}
        {jobs.map((job) => (
          <article key={job.id} className="border-b border-line bg-slate-50 px-4 py-4">
            <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="font-medium text-ink">
                  {job.display_name ? `${job.display_name} ` : ""}{job.symbol} · 任务 #{job.id}
                </div>
                <div className="mt-1 text-sm text-slate-500">
                  {job.status === "queued" ? `排队中，第 ${job.queue_position || 1} 位` : job.status === "running" ? job.current_stage : "生成失败"}
                </div>
              </div>
              <span className={`rounded border px-2 py-1 text-xs ${
                job.status === "failed"
                  ? "border-red-200 bg-red-50 text-red-700"
                  : job.status === "queued"
                    ? "border-amber-200 bg-amber-50 text-amber-800"
                    : "border-emerald-200 bg-emerald-50 text-emerald-700"
              }`}>
                {job.status === "failed" ? "失败" : job.status === "queued" ? "排队中" : "生成中"}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded bg-white">
              <div className="h-full rounded bg-accent" style={{ width: `${Math.max(3, Math.min(100, job.progress_percent))}%` }} />
            </div>
            {job.error && <p className="mt-2 text-sm leading-6 text-red-700">{job.error}</p>}
            {job.sections.some((section) => section.content?.trim()) && (
              <details className="mt-3 rounded border border-line bg-white p-3">
                <summary className="cursor-pointer text-sm font-medium text-ink">
                  查看已保存分段：{job.sections.filter((section) => section.content?.trim()).map((section) => section.title).join("、")}
                </summary>
                <div className="mt-3 space-y-3">
                  {job.sections.filter((section) => section.content?.trim()).map((section) => (
                    <article key={section.section_key}>
                      <h3 className="mb-1 text-sm font-semibold text-ink">{section.title}</h3>
                      <p className="max-h-56 overflow-auto whitespace-pre-wrap text-sm leading-7 text-slate-700">{section.content}</p>
                    </article>
                  ))}
                </div>
              </details>
            )}
          </article>
        ))}
        {records.map((record) => {
          const expanded = expandedId === record.id;
          return (
            <article key={record.id} className="border-b border-line last:border-b-0">
              <div className="flex flex-col gap-3 px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
                <button
                  onClick={() => setExpandedId(expanded ? null : record.id)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-line bg-slate-50 text-accent">
                    <ChevronDown size={17} className={expanded ? "rotate-180 transition-transform" : "transition-transform"} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-ink">
                      {record.display_name ? `${record.display_name} ` : ""}{record.symbol}
                    </span>
                    <span className="mt-1 block text-sm text-slate-500">
                      分析日期 {record.trade_date} ｜ 生成时间 {record.created_at}
                    </span>
                  </span>
                </button>
                <div className="flex shrink-0 gap-2">
                  <button
                    onClick={() => exportRecord(record)}
                    className="inline-flex items-center gap-2 rounded border border-line bg-white px-3 py-2 text-sm text-slate-700 hover:border-accent hover:text-accent"
                  >
                    <Download size={16} />
                    导出
                  </button>
                  <button
                    onClick={() => deleteRecord(record)}
                    className="inline-flex items-center gap-2 rounded border border-line bg-white px-3 py-2 text-sm text-slate-700 hover:border-red-300 hover:bg-red-50 hover:text-red-700"
                  >
                    <Trash2 size={16} />
                    删除
                  </button>
                </div>
              </div>
              {expanded && (
                <div className="border-t border-line bg-slate-50 p-4">
                  <div className="rounded border border-line bg-white p-4">
                    <TradingAgentsReportView report={record.report} onExport={() => exportRecord(record)} />
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </Section>
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

function TradingAgentsProgress({ elapsedSeconds, job }: { elapsedSeconds: number; job?: ReportJob | null }) {
  const progress = getTradingAgentProgress(elapsedSeconds);
  const percent = job ? Math.max(3, Math.min(100, job.progress_percent)) : progress.percent;
  const currentStage = job?.current_stage || progress.step.title;
  const sectionMap = new Map((job?.sections || []).map((section) => [section.section_key, section]));
  const completedSections = (job?.sections || []).filter((section) => section.content?.trim());

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-semibold text-ink">当前阶段：{currentStage}</div>
            <p className="text-sm leading-6 text-slate-600">
              {job?.status === "queued"
                ? `任务已进入队列，当前排第 ${job.queue_position || 1} 位。`
                : progress.step.detail}
            </p>
          </div>
          <div className="text-sm text-slate-500">已用时 {formatElapsed(elapsedSeconds)}</div>
        </div>
        <div className="h-2 overflow-hidden rounded bg-slate-100">
          <div className="h-full rounded bg-accent transition-all duration-500" style={{ width: `${percent}%` }} />
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {job ? `任务编号 #${job.id}，后台限制并发运行，多余请求会自动排队。` : "进度按 TradingAgents 的执行流程估算，报告返回后会自动切换为完整结果。"}
        </p>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        {tradingAgentProgressSteps.map((step, index) => {
          const sectionKey = progressStepSectionKeys[index];
          const section = sectionKey ? sectionMap.get(sectionKey) : null;
          const done = section?.status === "completed" || Boolean(section?.content?.trim()) || (!job && index < progress.index);
          const active = job
            ? !done && job.status === "running" && percent >= Math.max(3, index * 10)
            : index === progress.index;
          const status = done ? "已完成" : active ? "进行中" : "等待中";
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

      {completedSections.length > 0 && (
        <div className="space-y-3 border-t border-line pt-4">
          <div className="text-sm font-semibold text-ink">已生成内容</div>
          {completedSections.map((section) => (
            <article key={section.section_key} className="rounded border border-line bg-slate-50 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-ink">{section.title || agentSectionTitle(section.section_key)}</h3>
                <span className="text-xs text-emerald-700">已保存</span>
              </div>
              <p className="max-h-60 overflow-auto whitespace-pre-wrap text-sm leading-7 text-slate-700">{section.content}</p>
            </article>
          ))}
        </div>
      )}
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
