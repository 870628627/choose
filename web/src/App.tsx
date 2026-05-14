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
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  User,
  UserPlus
} from "lucide-react";
import { api, getAuthToken, setAuthToken } from "./api";
import type { AdminUser, AuthSession, ReportJob, ReportRecord, ReportSummary, ShowcaseReportRecord, TradingAgentsReport } from "./types";

type View = "home" | "a-share" | "us" | "crypto" | "admin";

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
  { name: "基本面 Agent", role: "查看公司资料、财务指标和经营变化，形成基本面判断。" },
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

const beijingDateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false
});

function formatBeijingDateTime(value?: string | null) {
  const raw = String(value || "").trim();
  if (!raw) return "-";
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  const isoLike = raw.includes("T") ? raw : raw.replace(" ", "T");
  const date = new Date(hasTimezone ? isoLike : `${isoLike}Z`);
  if (Number.isNaN(date.getTime())) return raw;
  return beijingDateTimeFormatter.format(date).replace(/\//g, "-");
}

function sanitizeAssetInput(assetType: ReportRecord["asset_type"], value: string) {
  if (assetType === "a-share") return value.replace(/\D/g, "").slice(0, 6);
  return value.toUpperCase().replace(/[^A-Z0-9._-]/g, "").slice(0, 32);
}

function isRunnableAssetSymbol(assetType: ReportRecord["asset_type"], value: string) {
  const symbol = value.trim();
  return assetType === "a-share" ? /^\d{6}$/.test(symbol) : Boolean(symbol);
}

function recentSearchKey(ownerKey: string, assetType: ReportRecord["asset_type"]) {
  return `alphascope_recent_searches_${ownerKey}_${assetType}`;
}

function loadRecentSearches(ownerKey: string, assetType: ReportRecord["asset_type"]) {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(recentSearchKey(ownerKey, assetType)) || "[]");
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).slice(0, 10)
      : [];
  } catch {
    return [];
  }
}

function saveRecentSearches(ownerKey: string, assetType: ReportRecord["asset_type"], values: string[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(recentSearchKey(ownerKey, assetType), JSON.stringify(values.slice(0, 10)));
  } catch {
    // 本地存储不可用时不阻塞报告生成。
  }
}

function safeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "").slice(0, 80) || "report";
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}

async function exportTradingAgentsWord(filename: string, report: TradingAgentsReport, stockName?: string) {
  const {
    AlignmentType,
    BorderStyle,
    Document,
    HeadingLevel,
    Packer,
    Paragraph,
    Table,
    TableCell,
    TableRow,
    TextRun,
    WidthType
  } = await import("docx");
  const title = `${stockName ? `${stockName} ` : ""}${report.code} TradingAgents 中文交易报告`;
  const border = { style: BorderStyle.SINGLE, size: 1, color: "D9E3E7" };
  const cellMargins = { top: 120, bottom: 120, left: 160, right: 160 };

  const inlineRuns = (text: string) => text.split(/(\*\*[^*]+?\*\*|`[^`]+?`)/g).filter(Boolean).map((part) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return new TextRun({ text: part.slice(2, -2), bold: true, color: "10202D" });
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return new TextRun({ text: part.slice(1, -1), font: "Consolas", color: "334155" });
    }
    return new TextRun({ text: part });
  });

  const paragraph = (text = "", options: Record<string, unknown> = {}) => new Paragraph({
    spacing: { after: 140 },
    children: inlineRuns(text),
    ...options
  });

  const tableCell = (text: string, header = false) => new TableCell({
    shading: header ? { fill: "F0F6F6" } : undefined,
    margins: cellMargins,
    children: [new Paragraph({
      children: inlineRuns(text),
      spacing: { after: 0 },
      run: { bold: header, color: header ? "223644" : "334155" }
    })],
    borders: { top: border, bottom: border, left: border, right: border }
  });

  const simpleTable = (rows: string[][], headerRows = 1) => new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
    rows: rows.map((row, rowIndex) => new TableRow({
      children: row.map((cell) => tableCell(cell, rowIndex < headerRows))
    }))
  });

  const markdownBlocks = (content: string) => {
    const lines = content.replace(/\r\n/g, "\n").split("\n");
    const blocks: Array<InstanceType<typeof Paragraph> | InstanceType<typeof Table>> = [];
    let index = 0;

    while (index < lines.length) {
      const line = lines[index].trimEnd();
      const trimmed = line.trim();
      if (!trimmed) {
        index += 1;
        continue;
      }

      const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
      if (heading) {
        blocks.push(paragraph(heading[2], {
          heading: heading[1].length <= 2 ? HeadingLevel.HEADING_3 : HeadingLevel.HEADING_4,
          spacing: { before: 180, after: 100 }
        }));
        index += 1;
        continue;
      }

      if (isMarkdownTableRow(line) && index + 1 < lines.length && isMarkdownTableSeparator(lines[index + 1])) {
        const tableLines = [line];
        index += 2;
        while (index < lines.length && isMarkdownTableRow(lines[index])) {
          tableLines.push(lines[index]);
          index += 1;
        }
        blocks.push(simpleTable(tableLines.map(splitMarkdownCells)));
        continue;
      }

      if (/^[-*]\s+/.test(trimmed)) {
        while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
          blocks.push(paragraph(lines[index].trim().replace(/^[-*]\s+/, ""), { bullet: { level: 0 } }));
          index += 1;
        }
        continue;
      }

      if (/^\d+\.\s+/.test(trimmed)) {
        let itemIndex = 1;
        while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
          blocks.push(paragraph(`${itemIndex}. ${lines[index].trim().replace(/^\d+\.\s+/, "")}`));
          index += 1;
          itemIndex += 1;
        }
        continue;
      }

      if (trimmed.startsWith("```")) {
        const codeLines: string[] = [];
        index += 1;
        while (index < lines.length && !lines[index].trim().startsWith("```")) {
          codeLines.push(lines[index]);
          index += 1;
        }
        if (index < lines.length) index += 1;
        blocks.push(new Paragraph({
          spacing: { before: 80, after: 140 },
          children: [new TextRun({ text: codeLines.join("\n"), font: "Consolas", color: "334155" })]
        }));
        continue;
      }

      if (trimmed.startsWith(">")) {
        const quoteLines: string[] = [];
        while (index < lines.length && lines[index].trim().startsWith(">")) {
          quoteLines.push(lines[index].trim().replace(/^>\s?/, ""));
          index += 1;
        }
        blocks.push(paragraph(quoteLines.join(" "), {
          indent: { left: 360 },
          border: { left: { style: BorderStyle.SINGLE, size: 8, color: "12A88A" } }
        }));
        continue;
      }

      const paragraphLines = [trimmed];
      index += 1;
      while (index < lines.length && lines[index].trim() && !isMarkdownBlockStart(lines[index])) {
        paragraphLines.push(lines[index].trim());
        index += 1;
      }
      blocks.push(paragraph(paragraphLines.join(" ")));
    }

    return blocks;
  };

  const children: Array<InstanceType<typeof Paragraph> | InstanceType<typeof Table>> = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 180 },
      children: [new TextRun({ text: title, bold: true, color: "10202D" })]
    }),
    simpleTable([
      ["代码", report.code],
      ["行情符号", report.symbol],
      ["分析日期", report.trade_date],
      ["分段数量", `${Object.values(report.sections).filter((value) => Boolean(value?.trim())).length}`],
      ["导出时间", new Date().toLocaleString("zh-CN", { hour12: false })]
    ], 0),
    paragraph("")
  ];

  Object.entries(report.sections).forEach(([key, value], index) => {
    if (!value?.trim()) return;
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { before: index === 0 ? 240 : 360, after: 120 },
      children: [new TextRun({ text: `${String(index + 1).padStart(2, "0")} ${agentSectionTitle(key)}`, bold: true, color: "10202D" })]
    }));
    children.push(...markdownBlocks(String(value).trim()));
  });

  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 360, after: 120 },
      children: [new TextRun({ text: "风险提示", bold: true, color: "76550B" })]
    }),
    paragraph(report.risk_notice, {
      shading: { fill: "FFF7DF" },
      border: {
        top: { style: BorderStyle.SINGLE, size: 1, color: "F0D58A" },
        bottom: { style: BorderStyle.SINGLE, size: 1, color: "F0D58A" },
        left: { style: BorderStyle.SINGLE, size: 1, color: "F0D58A" },
        right: { style: BorderStyle.SINGLE, size: 1, color: "F0D58A" }
      }
    })
  );

  const doc = new Document({
    creator: "AlphaScope",
    title,
    sections: [{
      properties: {
        page: {
          margin: { top: 900, right: 900, bottom: 900, left: 900 }
        }
      },
      children
    }]
  });
  const blob = await Packer.toBlob(doc);
  downloadBlob(filename, blob);
}

function formatElapsed(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes ? `${minutes}分${rest.toString().padStart(2, "0")}秒` : `${rest}秒`;
}

function accountLevelLabel(level: AdminUser["account_level"]) {
  return level === "vip" ? "VIP用户" : "普通用户";
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line py-5">
      <h2 className="mb-3 text-lg font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}

function isMarkdownTableRow(line: string) {
  return /^\s*\|.+\|\s*$/.test(line);
}

function isMarkdownTableSeparator(line: string) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function isMarkdownBlockStart(line: string) {
  return (
    /^#{1,6}\s+/.test(line)
    || /^[-*]\s+/.test(line)
    || /^\d+\.\s+/.test(line)
    || line.trim().startsWith("```")
    || isMarkdownTableRow(line)
  );
}

function splitMarkdownCells(line: string) {
  let value = line.trim();
  if (value.startsWith("|")) value = value.slice(1);
  if (value.endsWith("|")) value = value.slice(0, -1);
  return value.split("|").map((cell) => cell.trim());
}

function renderInlineMarkdown(text: string) {
  return text.split(/(\*\*[^*]+?\*\*|`[^`]+?`)/g).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index} className="font-semibold text-ink">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={index} className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[.92em] text-slate-800">{part.slice(1, -1)}</code>;
    }
    return <span key={index}>{part}</span>;
  });
}

function ReportMarkdown({ content }: { content: string }) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let index = 0;
  let blockIndex = 0;

  while (index < lines.length) {
    const line = lines[index].trimEnd();
    const trimmed = line.trim();
    if (!trimmed) {
      index += 1;
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const headingClass = heading[1].length <= 2
        ? "mt-5 border-l-2 border-accent pl-3 text-base font-semibold text-ink first:mt-0"
        : "mt-4 text-sm font-semibold text-slate-800";
      blocks.push(
        <h4 key={`heading-${blockIndex}`} className={headingClass}>
          {renderInlineMarkdown(heading[2])}
        </h4>
      );
      blockIndex += 1;
      index += 1;
      continue;
    }

    if (isMarkdownTableRow(line) && index + 1 < lines.length && isMarkdownTableSeparator(lines[index + 1])) {
      const tableLines = [line];
      index += 2;
      while (index < lines.length && isMarkdownTableRow(lines[index])) {
        tableLines.push(lines[index]);
        index += 1;
      }
      const rows = tableLines.map(splitMarkdownCells);
      const [headers, ...bodyRows] = rows;
      blocks.push(
        <div key={`table-${blockIndex}`} className="my-3 overflow-x-auto rounded border border-line">
          <table className="report-table">
            <thead>
              <tr>{headers.map((cell, cellIndex) => <th key={cellIndex}>{renderInlineMarkdown(cell)}</th>)}</tr>
            </thead>
            <tbody>
              {bodyRows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {headers.map((_, cellIndex) => <td key={cellIndex}>{renderInlineMarkdown(row[cellIndex] || "")}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      blockIndex += 1;
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^[-*]\s+/, ""));
        index += 1;
      }
      blocks.push(
        <ul key={`list-${blockIndex}`} className="my-2 space-y-1.5 pl-5 text-sm leading-7 text-slate-700">
          {items.map((item, itemIndex) => <li key={itemIndex} className="list-disc">{renderInlineMarkdown(item)}</li>)}
        </ul>
      );
      blockIndex += 1;
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^\d+\.\s+/, ""));
        index += 1;
      }
      blocks.push(
        <ol key={`ordered-${blockIndex}`} className="my-2 space-y-1.5 pl-5 text-sm leading-7 text-slate-700">
          {items.map((item, itemIndex) => <li key={itemIndex} className="list-decimal">{renderInlineMarkdown(item)}</li>)}
        </ol>
      );
      blockIndex += 1;
      continue;
    }

    if (trimmed.startsWith("```")) {
      const codeLines = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(
        <pre key={`code-${blockIndex}`} className="my-3 overflow-x-auto rounded border border-line bg-slate-950 p-3 text-xs leading-6 text-slate-100">
          <code>{codeLines.join("\n")}</code>
        </pre>
      );
      blockIndex += 1;
      continue;
    }

    const paragraphLines = [trimmed];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isMarkdownBlockStart(lines[index])) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }
    blocks.push(
      <p key={`paragraph-${blockIndex}`} className="my-2 text-sm leading-7 text-slate-700">
        {renderInlineMarkdown(paragraphLines.join(" "))}
      </p>
    );
    blockIndex += 1;
  }

  return <div className="report-prose">{blocks}</div>;
}

function AuthLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 text-slate-700">
      <div className="flex items-center gap-3 rounded border border-line bg-white px-4 py-3 shadow-sm">
        <Activity size={18} className="animate-pulse text-accent" />
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
    <div className="min-h-screen bg-slate-50 text-ink">
      <div className="absolute inset-0 opacity-70" style={{
        backgroundImage:
          "linear-gradient(rgba(15,118,110,.08) 1px, transparent 1px), linear-gradient(90deg, rgba(14,165,233,.08) 1px, transparent 1px)",
        backgroundSize: "42px 42px"
      }} />
      <main className="relative mx-auto grid min-h-screen max-w-6xl gap-8 px-4 py-10 lg:grid-cols-[1.1fr_.9fr] lg:items-center">
        <section className="space-y-6">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm text-accent">
              <ShieldCheck size={16} />
              私有报告库
            </div>
            <h1 className="text-4xl font-semibold tracking-normal text-ink sm:text-5xl">AlphaScope 全球资产研究台</h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">
              为 A股、美股和加密资产准备的多 Agent 研究工作台。每个账户拥有独立报告记录，登录后即可继续自己的研究线索。
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ["Market", "价格、成交量、技术结构"],
              ["Research", "新闻、情绪、基本面"],
              ["Execution", "交易方案、风控复核"]
            ].map(([label, value]) => (
              <div key={label} className="rounded border border-line bg-white p-4 shadow-sm">
                <div className="text-xs uppercase tracking-widest text-accent">{label}</div>
                <div className="mt-2 text-sm leading-6 text-slate-600">{value}</div>
              </div>
            ))}
          </div>
          <div className="overflow-hidden rounded border border-line bg-white shadow-sm">
            <div className="grid grid-cols-4 border-b border-line bg-slate-100 px-4 py-2 text-xs uppercase tracking-widest text-slate-500">
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
              <div key={row[0]} className="grid grid-cols-4 border-b border-line px-4 py-3 text-sm last:border-b-0">
                <span className="font-mono text-sky-700">{row[0]}</span>
                <span className="text-slate-700">{row[1]}</span>
                <span className={row[2] === "High" ? "text-amber-700" : row[2] === "Low" ? "text-emerald-700" : "text-slate-700"}>{row[2]}</span>
                <span className="text-slate-500">{row[3]}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded border border-line bg-white p-5 shadow-xl shadow-slate-200/80">
          <div className="mb-5 flex rounded border border-line bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setMode("login")}
              className={`flex flex-1 items-center justify-center gap-2 rounded px-3 py-2 text-sm ${
                mode === "login" ? "bg-white text-accent shadow-sm" : "text-slate-600 hover:text-ink"
              }`}
            >
              <LogIn size={16} />
              登录
            </button>
            <button
              type="button"
              onClick={() => setMode("register")}
              className={`flex flex-1 items-center justify-center gap-2 rounded px-3 py-2 text-sm ${
                mode === "register" ? "bg-white text-accent shadow-sm" : "text-slate-600 hover:text-ink"
              }`}
            >
              <UserPlus size={16} />
              注册
            </button>
          </div>

          <form className="space-y-4" onSubmit={submit}>
            <label className="block">
              <span className="mb-1 flex items-center gap-2 text-sm text-slate-600"><User size={15} />邮箱</span>
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value.trim().slice(0, 254))}
                type="email"
                autoComplete="username"
                placeholder="trader@example.com"
                className="w-full rounded border border-line bg-white px-3 py-2 text-ink outline-none focus:border-accent focus:ring-2 focus:ring-emerald-100"
              />
            </label>
            <label className="block">
              <span className="mb-1 flex items-center gap-2 text-sm text-slate-600"><LockKeyhole size={15} />密码</span>
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value.slice(0, 128))}
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                placeholder="至少 8 位"
                className="w-full rounded border border-line bg-white px-3 py-2 text-ink outline-none focus:border-accent focus:ring-2 focus:ring-emerald-100"
              />
            </label>
            {error && (
              <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm leading-6 text-red-700">
                {error}
              </div>
            )}
            <button
              disabled={busy || !email.includes("@") || password.length < 8}
              className="flex w-full items-center justify-center gap-2 rounded border border-accent bg-accent px-4 py-2.5 font-medium text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
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

  const handleAuthenticated = (nextSession: AuthSession) => {
    setAuthToken(nextSession.token);
    setSession(nextSession);
  };

  const logout = async () => {
    try {
      await api.logout();
    } catch {
      // 本地清理仍然继续，避免网络抖动把用户困在当前会话。
    }
    setAuthToken("");
    setSession(null);
    setView("home");
  };

  useEffect(() => {
    if (view === "admin" && !session?.user.is_super_admin) {
      setView("home");
    }
  }, [view, session?.user.is_super_admin]);

  if (!authReady) return <AuthLoading />;
  if (!session) return <AuthShell onAuthenticated={handleAuthenticated} />;

  return (
    <div className="min-h-screen bg-paper pb-20">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal text-ink">AlphaScope 全球资产研究台</h1>
            <p className="text-sm text-slate-600">Agent 研究、A股报告、美股报告和加密资产报告</p>
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
            {session.user.is_super_admin && (
              <button
                onClick={() => setView("admin")}
                className={`inline-flex items-center gap-2 rounded border px-3 py-2 text-sm ${
                  view === "admin" ? "border-accent bg-teal-50 text-accent" : "border-line bg-white text-slate-700"
                }`}
                title="后台管理"
              >
                <ShieldCheck size={16} />
                后台管理
              </button>
            )}
            <div className="flex items-center gap-2 rounded border border-line bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <User size={16} />
              {session.user.display_name}
              {session.user.is_super_admin && (
                <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-700">超级管理员</span>
              )}
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
        {view === "home" && <HomeView />}
        {view === "a-share" && (
          <AssetReportPage
            assetType="a-share"
            title="A股 TradingAgents 报告"
            description="输入 A 股代码直接生成中文交易研究报告。"
            placeholder="例如 600519、300750、688213"
            examples={["600519", "300750", "688213", "000001"]}
            storageOwnerKey={String(session.user.id)}
          />
        )}
        {view === "us" && (
          <AssetReportPage
            assetType="us"
            title="美股 TradingAgents 报告"
            description="输入美股符号生成中文交易研究报告。"
            placeholder="例如 NVDA、AAPL、MSFT"
            examples={["NVDA", "AAPL", "MSFT", "TSLA"]}
            storageOwnerKey={String(session.user.id)}
          />
        )}
        {view === "crypto" && (
          <AssetReportPage
            assetType="crypto"
            title="加密资产 TradingAgents 报告"
            description="输入加密资产符号生成中文交易研究报告。"
            placeholder="例如 BTC-USD、ETH-USD、SOL-USD"
            examples={["BTC-USD", "ETH-USD", "SOL-USD", "BNB-USD"]}
            storageOwnerKey={String(session.user.id)}
          />
        )}
        {view === "admin" && session.user.is_super_admin && <AdminView />}
      </main>

      <footer className="fixed inset-x-0 bottom-0 border-t border-line bg-white px-4 py-3 text-center text-sm text-slate-700">
        AlphaScope 可生成多资产研究、交易观点、目标价和涨跌判断。模型结论可能错误或滞后，实际交易请自行确认数据并控制风险。
      </footer>
    </div>
  );
}

function HomeView() {
  const [showcaseReports, setShowcaseReports] = useState<ShowcaseReportRecord[]>([]);
  const [expandedReportId, setExpandedReportId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadShowcaseReports = async () => {
    setLoading(true);
    setError("");
    try {
      const reports = await api.showcaseReports();
      setShowcaseReports(reports);
      if (!expandedReportId && reports[0]) setExpandedReportId(reports[0].id);
    } catch (requestError) {
      setError((requestError as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadShowcaseReports();
  }, []);

  const expandedReport = showcaseReports.find((record) => record.id === expandedReportId);
  const exportShowcaseReport = (record: ShowcaseReportRecord) => {
    const label = record.display_name || record.symbol;
    const name = `${safeFileName(record.symbol)}-${safeFileName(label)}-${safeFileName(record.trade_date)}.docx`;
    return exportTradingAgentsWord(name, record.report, record.display_name).catch((error) => {
      console.error(error);
      alert("Word 生成失败，请稍后重试。");
    });
  };

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

      <Section title="报告展厅">
        <div className="rounded border border-line bg-white">
          <div className="flex flex-col gap-2 border-b border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-semibold text-ink">精选研究报告</div>
              <p className="mt-1 text-sm text-slate-600">由管理员从历史报告中挑选展示，方便快速查看报告样式和分析深度。</p>
            </div>
            <button
              onClick={loadShowcaseReports}
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
          {!loading && !showcaseReports.length && !error && (
            <div className="px-4 py-8 text-center text-sm text-slate-500">
              暂无展示报告。管理员可在后台管理里选择历史报告加入展厅。
            </div>
          )}
          {showcaseReports.length > 0 && (
            <div className="grid gap-4 p-4 lg:grid-cols-[320px_1fr]">
              <div className="space-y-2">
                {showcaseReports.map((record) => (
                  <button
                    key={record.id}
                    onClick={() => setExpandedReportId(record.id)}
                    className={`w-full rounded border p-3 text-left ${
                      expandedReportId === record.id
                        ? "border-accent bg-teal-50"
                        : "border-line bg-slate-50 hover:border-accent"
                    }`}
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="font-mono text-sm font-semibold text-accent">{record.symbol}</span>
                      <span className="rounded border border-line bg-white px-2 py-1 text-xs text-slate-600">
                        {assetTypeLabels[record.asset_type]}
                      </span>
                    </div>
                    <div className="truncate text-sm font-medium text-ink">{record.display_name || record.symbol}</div>
                    <div className="mt-1 text-xs text-slate-500">分析日期 {record.trade_date}</div>
                  </button>
                ))}
              </div>
              <div className="min-w-0 rounded border border-line bg-white p-4">
                {expandedReport ? (
                  <TradingAgentsReportView report={expandedReport.report} onExport={() => exportShowcaseReport(expandedReport)} />
                ) : (
                  <p className="text-sm text-slate-500">选择左侧报告查看详情。</p>
                )}
              </div>
            </div>
          )}
        </div>
      </Section>
    </div>
  );
}

function AdminView() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [reports, setReports] = useState<ShowcaseReportRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [savingUserId, setSavingUserId] = useState<number | null>(null);
  const [savingReportId, setSavingReportId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [reportError, setReportError] = useState("");

  const loadUsers = async () => {
    setLoading(true);
    setError("");
    try {
      setUsers(await api.adminUsers());
    } catch (requestError) {
      setError((requestError as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const loadReports = async () => {
    setReportLoading(true);
    setReportError("");
    try {
      setReports(await api.adminShowcaseReports());
    } catch (requestError) {
      setReportError((requestError as Error).message);
    } finally {
      setReportLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
    loadReports();
  }, []);

  const updateLevel = async (user: AdminUser, level: AdminUser["account_level"]) => {
    if (user.account_level === level || user.is_super_admin) return;
    setSavingUserId(user.id);
    setError("");
    try {
      const updated = await api.updateAdminUser(user.id, level);
      setUsers((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (requestError) {
      setError((requestError as Error).message);
    } finally {
      setSavingUserId(null);
    }
  };

  const toggleShowcase = async (record: ShowcaseReportRecord) => {
    setSavingReportId(record.id);
    setReportError("");
    try {
      const updated = await api.toggleShowcaseReport(record.id, !record.is_showcased);
      setReports((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (requestError) {
      setReportError((requestError as Error).message);
    } finally {
      setSavingReportId(null);
    }
  };

  return (
    <div>
      <section className="border-b border-line pb-5">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-ink">后台用户管理</h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              仅超级管理员可访问。当前支持普通用户和 VIP 用户两类，暂不区分业务权限。
            </p>
          </div>
          <button
            onClick={loadUsers}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded border border-line bg-white px-3 py-2 text-sm text-slate-700 disabled:opacity-50"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            刷新用户
          </button>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded border border-line bg-white p-4">
            <div className="text-xs text-slate-500">用户总数</div>
            <div className="mt-1 text-2xl font-semibold text-ink">{users.length}</div>
          </div>
          <div className="rounded border border-line bg-white p-4">
            <div className="text-xs text-slate-500">VIP 用户</div>
            <div className="mt-1 text-2xl font-semibold text-ink">{users.filter((user) => user.account_level === "vip").length}</div>
          </div>
          <div className="rounded border border-line bg-white p-4">
            <div className="text-xs text-slate-500">运行中任务</div>
            <div className="mt-1 text-2xl font-semibold text-ink">{users.reduce((sum, user) => sum + user.active_job_count, 0)}</div>
          </div>
        </div>
      </section>

      <Section title="用户列表">
        <div className="rounded border border-line bg-white">
          {error && (
            <div className="m-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>用户</th>
                  <th>等级</th>
                  <th>报告数</th>
                  <th>运行任务</th>
                  <th>最近在线（北京时间）</th>
                  <th>创建时间（北京时间）</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className={user.is_super_admin ? "bg-emerald-50/70" : "hover:bg-slate-50"}>
                    <td>
                      <div className="font-medium text-ink">{user.display_name}</div>
                      <div className="mt-1 font-mono text-xs text-slate-500">{user.email}</div>
                      {user.is_super_admin && (
                        <span className="mt-2 inline-flex rounded border border-emerald-200 bg-white px-2 py-1 text-xs text-emerald-700">
                          最高超级管理员
                        </span>
                      )}
                    </td>
                    <td>{accountLevelLabel(user.account_level)}</td>
                    <td>{user.report_count}</td>
                    <td>{user.active_job_count}</td>
                    <td>{formatBeijingDateTime(user.last_seen_at)}</td>
                    <td>{formatBeijingDateTime(user.created_at)}</td>
                    <td>
                      <select
                        value={user.account_level}
                        disabled={user.is_super_admin || savingUserId === user.id}
                        onChange={(event) => updateLevel(user, event.target.value as AdminUser["account_level"])}
                        className="rounded border border-line bg-white px-3 py-2 text-sm outline-none focus:border-accent disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                      >
                        <option value="regular">普通用户</option>
                        <option value="vip">VIP用户</option>
                      </select>
                    </td>
                  </tr>
                ))}
                {!loading && !users.length && (
                  <tr>
                    <td colSpan={7} className="text-center text-slate-500">暂无用户数据。</td>
                  </tr>
                )}
                {loading && (
                  <tr>
                    <td colSpan={7} className="text-center text-slate-500">正在加载用户...</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </Section>

      <Section title="报告展厅管理">
        <div className="rounded border border-line bg-white">
          <div className="flex flex-col gap-2 border-b border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-semibold text-ink">历史报告展示控制</div>
              <p className="mt-1 text-sm text-slate-600">选择历史报告加入首页展厅；取消展示不会删除原报告。</p>
            </div>
            <button
              onClick={loadReports}
              disabled={reportLoading}
              className="inline-flex items-center justify-center gap-2 rounded border border-line bg-white px-3 py-2 text-sm text-slate-700 disabled:opacity-50"
            >
              <RefreshCw size={16} className={reportLoading ? "animate-spin" : ""} />
              刷新报告
            </button>
          </div>
          {reportError && (
            <div className="m-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {reportError}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>报告</th>
                  <th>类型</th>
                  <th>归属用户</th>
                  <th>分析日期</th>
                  <th>生成时间（北京时间）</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((record) => (
                  <tr key={record.id} className={record.is_showcased ? "bg-teal-50" : "hover:bg-slate-50"}>
                    <td>
                      <div className="font-medium text-ink">{record.display_name || record.symbol}</div>
                      <div className="mt-1 font-mono text-xs text-slate-500">{record.symbol}</div>
                    </td>
                    <td>{assetTypeLabels[record.asset_type]}</td>
                    <td className="font-mono text-xs text-slate-600">{record.owner_email || "-"}</td>
                    <td>{record.trade_date}</td>
                    <td>{formatBeijingDateTime(record.created_at)}</td>
                    <td>
                      <span className={`rounded border px-2 py-1 text-xs ${
                        record.is_showcased
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-line bg-slate-50 text-slate-600"
                      }`}>
                        {record.is_showcased ? "首页展示中" : "未展示"}
                      </span>
                    </td>
                    <td>
                      <button
                        onClick={() => toggleShowcase(record)}
                        disabled={savingReportId === record.id}
                        className={`inline-flex items-center justify-center rounded border px-3 py-2 text-sm disabled:opacity-50 ${
                          record.is_showcased
                            ? "border-line bg-white text-slate-700 hover:border-red-300 hover:bg-red-50 hover:text-red-700"
                            : "border-accent bg-accent text-white hover:bg-teal-700"
                        }`}
                      >
                        {savingReportId === record.id ? "处理中" : record.is_showcased ? "取消展示" : "展示到首页"}
                      </button>
                    </td>
                  </tr>
                ))}
                {!reportLoading && !reports.length && (
                  <tr>
                    <td colSpan={7} className="text-center text-slate-500">暂无历史报告。生成报告后可在这里选择展示。</td>
                  </tr>
                )}
                {reportLoading && (
                  <tr>
                    <td colSpan={7} className="text-center text-slate-500">正在加载报告...</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </Section>
    </div>
  );
}

function AssetReportPage({
  assetType,
  title,
  description,
  placeholder,
  examples,
  storageOwnerKey
}: {
  assetType: ReportRecord["asset_type"];
  title: string;
  description: string;
  placeholder: string;
  examples: string[];
  storageOwnerKey: string;
}) {
  const [symbol, setSymbol] = useState("");
  const [recentSearches, setRecentSearches] = useState<string[]>(() => loadRecentSearches(storageOwnerKey, assetType));
  const [report, setReport] = useState<TradingAgentsReport | null>(null);
  const [job, setJob] = useState<ReportJob | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [historyVersion, setHistoryVersion] = useState(0);

  useEffect(() => {
    setRecentSearches(loadRecentSearches(storageOwnerKey, assetType));
  }, [assetType, storageOwnerKey]);

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
        } else if (nextJob.status === "cancelled") {
          setError(nextJob.error || "已停止生成");
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
    const normalized = sanitizeAssetInput(assetType, nextSymbol).trim();
    if (!isRunnableAssetSymbol(assetType, normalized)) {
      setError(assetType === "a-share" ? "请输入 6 位 A 股代码。" : "请输入资产符号。");
      return;
    }
    setSymbol(normalized);
    setLoading(true);
    setError("");
    setReport(null);
    setJob(null);
    setElapsedSeconds(0);
    setRecentSearches((current) => {
      const nextSearches = [normalized, ...current.filter((item) => item !== normalized)].slice(0, 10);
      saveRecentSearches(storageOwnerKey, assetType, nextSearches);
      return nextSearches;
    });
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
    const name = `${safeFileName(report.code)}-${safeFileName(report.trade_date)}.docx`;
    return exportTradingAgentsWord(name, report).catch((error) => {
      console.error(error);
      alert("Word 生成失败，请稍后重试。");
    });
  };

  const stopReport = async () => {
    if (!job) return;
    try {
      const nextJob = await api.cancelReportJob(job.id);
      setJob(nextJob);
      setError(nextJob.error || "已停止生成");
    } catch (requestError) {
      setError((requestError as Error).message);
    } finally {
      setLoading(false);
    }
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
            <span className="mb-1 block text-sm font-medium text-slate-700">资产代码 / 符号</span>
            <input
              value={symbol}
              onChange={(event) => setSymbol(sanitizeAssetInput(assetType, event.target.value))}
              onKeyDown={(event) => {
                if (event.key === "Enter") runReport();
              }}
              placeholder={placeholder}
              className="w-full rounded border border-line bg-white px-3 py-2 outline-none focus:border-accent"
            />
          </label>
          <button
            disabled={loading || !isRunnableAssetSymbol(assetType, symbol)}
            onClick={() => runReport()}
            className="inline-flex items-center justify-center gap-2 rounded border border-accent bg-accent px-4 py-2 text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Sparkles size={16} />
            {loading ? "生成中" : "生成报告"}
          </button>
        </div>
        {recentSearches.length > 0 && (
          <div className="mt-3">
            <div className="mb-2 text-xs font-medium text-slate-500">最近搜索（最多10个）</div>
            <div className="flex flex-wrap gap-2">
              {recentSearches.map((item) => (
                <button
                  key={item}
                  onClick={() => runReport(item)}
                  disabled={loading}
                  className="rounded border border-line bg-white px-3 py-1.5 font-mono text-sm text-slate-700 hover:border-accent hover:text-accent disabled:opacity-50"
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="mt-3">
          <div className="mb-2 text-xs font-medium text-slate-500">常用示例</div>
          <div className="flex flex-wrap gap-2">
            {examples.map((example) => (
              <button
                key={example}
                onClick={() => runReport(example)}
                disabled={loading}
                className="rounded border border-line bg-white px-3 py-1.5 text-sm text-slate-700 hover:border-accent hover:text-accent disabled:opacity-50"
              >
                {example}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="py-5">
        <div className="rounded border border-line bg-white p-4">
          {!report && !loading && !error && (
            <p className="text-sm leading-6 text-slate-600">输入符号后即可生成 TradingAgents 中文报告。</p>
          )}
          {loading && <TradingAgentsProgress elapsedSeconds={elapsedSeconds} job={job} />}
          {loading && job && (
            <div className="mt-4">
              <button
                onClick={stopReport}
                className="inline-flex items-center gap-2 rounded border border-red-200 bg-white px-3 py-2 text-sm text-red-700 hover:bg-red-50"
              >
                <Square size={15} />
                停止生成
              </button>
            </div>
          )}
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

function ReportHistory({
  assetType,
  refreshKey
}: {
  assetType: ReportRecord["asset_type"];
  refreshKey: number;
}) {
  const [records, setRecords] = useState<ReportSummary[]>([]);
  const [recordDetails, setRecordDetails] = useState<Record<number, ReportRecord>>({});
  const [detailLoadingId, setDetailLoadingId] = useState<number | null>(null);
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
      setRecordDetails((current) => {
        const visibleIds = new Set(nextRecords.map((record) => record.id));
        return Object.fromEntries(Object.entries(current).filter(([id]) => visibleIds.has(Number(id))));
      });
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

  const ensureRecordDetail = async (record: ReportSummary) => {
    const cached = recordDetails[record.id];
    if (cached) return cached;
    setDetailLoadingId(record.id);
    try {
      const detail = await api.report(record.id);
      setRecordDetails((current) => ({ ...current, [record.id]: detail }));
      return detail;
    } finally {
      setDetailLoadingId((current) => current === record.id ? null : current);
    }
  };

  const toggleRecord = (record: ReportSummary) => {
    const expanded = expandedId === record.id;
    if (expanded) {
      setExpandedId(null);
      return;
    }
    setExpandedId(record.id);
    ensureRecordDetail(record).catch((requestError) => {
      setError((requestError as Error).message);
    });
  };

  const deleteRecord = async (record: ReportSummary) => {
    const confirmed = window.confirm(`确定删除 ${record.symbol} ${record.trade_date} 的报告记录吗？`);
    if (!confirmed) return;
    await api.deleteReport(record.id);
    setRecords((current) => current.filter((item) => item.id !== record.id));
    setRecordDetails((current) => {
      const next = { ...current };
      delete next[record.id];
      return next;
    });
    if (expandedId === record.id) setExpandedId(null);
  };

  const exportRecord = async (record: ReportSummary) => {
    const label = record.display_name || record.symbol;
    const name = `${safeFileName(record.symbol)}-${safeFileName(label)}-${safeFileName(record.trade_date)}.docx`;
    try {
      const detail = await ensureRecordDetail(record);
      await exportTradingAgentsWord(name, detail.report, record.display_name);
    } catch (error) {
      console.error(error);
      alert("Word 生成失败，请稍后重试。");
    }
  };

  const stopJob = async (job: ReportJob) => {
    const nextJob = await api.cancelReportJob(job.id);
    setJobs((current) => current.map((item) => item.id === nextJob.id ? nextJob : item));
  };

  const deleteJob = async (job: ReportJob) => {
    const confirmed = window.confirm(`确定删除 ${job.symbol} 的${job.status === "cancelled" ? "已停止" : "失败"}任务吗？已保存的分段也会删除。`);
    if (!confirmed) return;
    await api.deleteReportJob(job.id);
    setJobs((current) => current.filter((item) => item.id !== job.id));
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
                  {job.status === "queued"
                    ? `排队中，第 ${job.queue_position || 1} 位`
                    : job.status === "running"
                      ? job.current_stage
                      : job.status === "cancelled"
                        ? "已停止"
                        : "生成失败"}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {(job.status === "queued" || job.status === "running") && (
                  <button
                    onClick={() => stopJob(job)}
                    className="inline-flex items-center gap-1 rounded border border-red-200 bg-white px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                  >
                    <Square size={13} />
                    停止
                  </button>
                )}
                {(job.status === "failed" || job.status === "cancelled") && (
                  <button
                    onClick={() => deleteJob(job)}
                    className="inline-flex items-center gap-1 rounded border border-line bg-white px-2 py-1 text-xs text-slate-700 hover:border-red-300 hover:bg-red-50 hover:text-red-700"
                  >
                    <Trash2 size={13} />
                    删除
                  </button>
                )}
                <span className={`rounded border px-2 py-1 text-xs ${
                  job.status === "failed"
                    ? "border-red-200 bg-red-50 text-red-700"
                    : job.status === "cancelled"
                      ? "border-slate-200 bg-white text-slate-600"
                      : job.status === "queued"
                        ? "border-amber-200 bg-amber-50 text-amber-800"
                        : "border-emerald-200 bg-emerald-50 text-emerald-700"
                }`}>
                  {job.status === "failed" ? "失败" : job.status === "cancelled" ? "已停止" : job.status === "queued" ? "排队中" : "生成中"}
                </span>
              </div>
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
          const detail = recordDetails[record.id];
          const detailLoading = detailLoadingId === record.id;
          return (
            <article key={record.id} className="border-b border-line last:border-b-0">
              <div className="flex flex-col gap-3 px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
                <button
                  onClick={() => toggleRecord(record)}
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
                    导出Word
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
                    {detail ? (
                      <TradingAgentsReportView report={detail.report} onExport={() => exportRecord(record)} />
                    ) : (
                      <div className="flex items-center gap-2 text-sm text-slate-500">
                        <RefreshCw size={15} className={detailLoading ? "animate-spin" : ""} />
                        正在加载报告正文...
                      </div>
                    )}
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

function TradingAgentsReportView({ report, onExport }: { report: TradingAgentsReport; onExport: () => void | Promise<void> }) {
  const sectionEntries = Object.entries(report.sections).filter(([, value]) => Boolean(value?.trim()));
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      await onExport();
    } catch (error) {
      console.error(error);
      alert("Word 生成失败，请稍后重试。");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="overflow-hidden rounded border border-slate-800 bg-[#0d141b] text-slate-100">
        <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="mb-2 text-xs uppercase tracking-[.22em] text-emerald-300">TradingAgents Research</div>
            <h2 className="text-2xl font-semibold tracking-normal text-white">{report.code} 中文交易报告</h2>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-300">
              <span className="rounded border border-white/10 bg-white/5 px-2.5 py-1">行情符号 {report.symbol}</span>
              <span className="rounded border border-white/10 bg-white/5 px-2.5 py-1">分析日期 {report.trade_date}</span>
              <span className="rounded border border-white/10 bg-white/5 px-2.5 py-1">{sectionEntries.length} 个分段</span>
            </div>
          </div>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="inline-flex items-center justify-center gap-2 rounded border border-emerald-300/40 bg-emerald-300 px-3 py-2 text-sm text-slate-950 hover:bg-emerald-200 disabled:cursor-wait disabled:opacity-70"
            title="导出 Word"
          >
            {exporting ? <Activity size={16} className="animate-pulse" /> : <Download size={16} />}
            {exporting ? "生成Word中" : "导出Word"}
          </button>
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-3">
        {sectionEntries.map(([key]) => (
          <a key={key} href={`#report-section-${key}`} className="rounded border border-line bg-slate-50 px-3 py-2 text-sm text-slate-700 hover:border-accent hover:text-accent">
            {agentSectionTitle(key)}
          </a>
        ))}
      </div>

      <div className="space-y-5">
        {sectionEntries.map(([key, value], index) => (
          <article key={key} id={`report-section-${key}`} className="scroll-mt-4 border-t border-line pt-5">
            <div className="mb-3 flex items-center gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-accent/30 bg-teal-50 font-mono text-xs text-accent">
                {String(index + 1).padStart(2, "0")}
              </span>
              <h3 className="text-lg font-semibold text-ink">{agentSectionTitle(key)}</h3>
            </div>
            <ReportMarkdown content={String(value)} />
          </article>
        ))}
      </div>

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

function escapeHtml(value: string) {
  const entities: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  };
  return value.replace(/[&<>"']/g, (char) => entities[char]);
}

function safeHtmlId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-") || "section";
}

function renderInlineMarkdownHtml(text: string) {
  return text.split(/(\*\*[^*]+?\*\*|`[^`]+?`)/g).map((part) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return `<strong>${escapeHtml(part.slice(2, -2))}</strong>`;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
    }
    return escapeHtml(part);
  }).join("");
}

function markdownToHtml(content: string) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index].trimEnd();
    const trimmed = line.trim();
    if (!trimmed) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith("```")) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length <= 2 ? 3 : 4;
      blocks.push(`<h${level}>${renderInlineMarkdownHtml(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (isMarkdownTableRow(line) && index + 1 < lines.length && isMarkdownTableSeparator(lines[index + 1])) {
      const tableLines = [line];
      index += 2;
      while (index < lines.length && isMarkdownTableRow(lines[index])) {
        tableLines.push(lines[index]);
        index += 1;
      }
      const rows = tableLines.map(splitMarkdownCells);
      const [headers, ...bodyRows] = rows;
      blocks.push(`
        <div class="table-wrap">
          <table>
            <thead><tr>${headers.map((cell) => `<th>${renderInlineMarkdownHtml(cell)}</th>`).join("")}</tr></thead>
            <tbody>
              ${bodyRows.map((row) => `<tr>${headers.map((_, cellIndex) => `<td>${renderInlineMarkdownHtml(row[cellIndex] || "")}</td>`).join("")}</tr>`).join("")}
            </tbody>
          </table>
        </div>
      `);
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^[-*]\s+/, ""));
        index += 1;
      }
      blocks.push(`<ul>${items.map((item) => `<li>${renderInlineMarkdownHtml(item)}</li>`).join("")}</ul>`);
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^\d+\.\s+/, ""));
        index += 1;
      }
      blocks.push(`<ol>${items.map((item) => `<li>${renderInlineMarkdownHtml(item)}</li>`).join("")}</ol>`);
      continue;
    }

    if (trimmed.startsWith(">")) {
      const quoteLines: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith(">")) {
        quoteLines.push(lines[index].trim().replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push(`<blockquote>${renderInlineMarkdownHtml(quoteLines.join(" "))}</blockquote>`);
      continue;
    }

    const paragraphLines = [trimmed];
    index += 1;
    while (index < lines.length) {
      const next = lines[index].trim();
      if (!next || isMarkdownBlockStart(next) || next.startsWith(">")) break;
      paragraphLines.push(next);
      index += 1;
    }
    blocks.push(`<p>${renderInlineMarkdownHtml(paragraphLines.join(" "))}</p>`);
  }

  return blocks.join("\n");
}

function buildTradingAgentsHtml(report: TradingAgentsReport, stockName?: string) {
  const title = `${stockName ? `${stockName} ` : ""}${report.code} TradingAgents 中文交易报告`;
  const sectionEntries = Object.entries(report.sections).filter(([, value]) => Boolean(value?.trim()));
  const generatedAt = new Date().toLocaleString("zh-CN", { hour12: false });
  const navItemsHtml = sectionEntries.map(([key], index) => {
    const label = agentSectionTitle(key);
    return `<a href="#${safeHtmlId(key)}"><span>${String(index + 1).padStart(2, "0")}</span>${escapeHtml(label)}</a>`;
  }).join("");
  const sectionHtml = sectionEntries.map(([key, value], index) => `
    <article id="${safeHtmlId(key)}" class="section">
      <div class="section-title">
        <span>${String(index + 1).padStart(2, "0")}</span>
        <h2>${escapeHtml(agentSectionTitle(key))}</h2>
      </div>
      <div class="markdown">${markdownToHtml(String(value).trim())}</div>
    </article>
  `).join("");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #10202d;
      --muted: #5f6f7b;
      --line: #d9e3e7;
      --panel: #ffffff;
      --page: #f4f7f8;
      --accent: #12a88a;
      --accent-soft: #e7f7f3;
      --amber: #fff7df;
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      background: var(--page);
      color: var(--ink);
      font-family: Inter, "Segoe UI", "PingFang SC", "Microsoft YaHei", Arial, sans-serif;
      line-height: 1.78;
    }
    .shell {
      width: min(1080px, calc(100% - 40px));
      margin: 32px auto;
    }
    .hero {
      overflow: hidden;
      border: 1px solid #0f2632;
      border-radius: 8px;
      background: #0d141b;
      color: #f8fbfc;
    }
    .hero-inner {
      display: grid;
      gap: 28px;
      padding: 34px;
    }
    .eyebrow {
      margin-bottom: 10px;
      color: #8ee4d1;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: .18em;
      text-transform: uppercase;
    }
    h1 {
      margin: 0;
      font-size: clamp(28px, 4vw, 44px);
      line-height: 1.16;
      letter-spacing: 0;
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 20px;
      color: #c9d5da;
      font-size: 13px;
    }
    .meta span {
      border: 1px solid rgba(255,255,255,.12);
      border-radius: 6px;
      background: rgba(255,255,255,.05);
      padding: 5px 10px;
    }
    .toc {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
      gap: 10px;
      margin: 18px 0;
    }
    .toc a {
      display: flex;
      align-items: center;
      gap: 10px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--panel);
      padding: 11px 12px;
      color: var(--ink);
      text-decoration: none;
      font-size: 14px;
      font-weight: 650;
    }
    .toc span, .section-title span {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
      width: 30px;
      height: 30px;
      border: 1px solid rgba(18,168,138,.32);
      border-radius: 6px;
      background: var(--accent-soft);
      color: var(--accent);
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
      font-weight: 700;
    }
    .section, .risk {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      padding: 26px;
      margin-top: 16px;
      box-shadow: 0 10px 24px rgba(16,32,45,.05);
    }
    .section-title {
      display: flex;
      align-items: center;
      gap: 12px;
      border-bottom: 1px solid var(--line);
      padding-bottom: 14px;
      margin-bottom: 18px;
    }
    .section-title h2 {
      margin: 0;
      font-size: 22px;
      line-height: 1.35;
      letter-spacing: 0;
    }
    .markdown h3 {
      border-left: 3px solid var(--accent);
      padding-left: 12px;
      margin: 24px 0 12px;
      font-size: 17px;
      line-height: 1.45;
    }
    .markdown h4 {
      margin: 20px 0 10px;
      font-size: 15px;
      color: #263947;
    }
    .markdown p {
      margin: 10px 0;
      color: #354957;
      font-size: 15px;
    }
    .markdown ul, .markdown ol {
      margin: 10px 0;
      padding-left: 24px;
      color: #354957;
      font-size: 15px;
    }
    .markdown li { margin: 4px 0; }
    strong { color: var(--ink); font-weight: 760; }
    code {
      border-radius: 4px;
      background: #eef3f5;
      padding: 2px 5px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: .92em;
    }
    pre {
      overflow-x: auto;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #0d141b;
      color: #e9f2f4;
      padding: 14px;
    }
    blockquote {
      margin: 14px 0;
      border-left: 3px solid var(--accent);
      background: #f6faf9;
      padding: 10px 14px;
      color: #415562;
    }
    .table-wrap {
      overflow-x: auto;
      border: 1px solid var(--line);
      border-radius: 6px;
      margin: 14px 0;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 640px;
      font-size: 14px;
    }
    th, td {
      border-bottom: 1px solid var(--line);
      padding: 10px 12px;
      text-align: left;
      vertical-align: top;
    }
    th {
      background: #f0f6f6;
      color: #223644;
      font-weight: 760;
    }
    tr:last-child td { border-bottom: 0; }
    .risk {
      border-color: #f0d58a;
      background: var(--amber);
      color: #76550b;
      font-size: 14px;
    }
    .risk strong { display: block; margin-bottom: 6px; color: #5f4308; }
    @media print {
      body { background: #fff; }
      .shell { width: 100%; margin: 0; }
      .hero, .section, .risk { box-shadow: none; break-inside: avoid; }
      .toc { display: none; }
      a { color: inherit; }
    }
    @media (max-width: 640px) {
      .shell { width: min(100% - 24px, 1080px); margin: 18px auto; }
      .hero-inner, .section, .risk { padding: 20px; }
      h1 { font-size: 28px; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <header class="hero">
      <div class="hero-inner">
        <div>
          <div class="eyebrow">TradingAgents Research</div>
          <h1>${escapeHtml(title)}</h1>
          <div class="meta">
            <span>代码 ${escapeHtml(report.code)}</span>
            <span>行情符号 ${escapeHtml(report.symbol)}</span>
            <span>分析日期 ${escapeHtml(report.trade_date)}</span>
            <span>${sectionEntries.length} 个分段</span>
            <span>导出时间 ${escapeHtml(generatedAt)}</span>
          </div>
        </div>
      </div>
    </header>

    <nav class="toc">${navItemsHtml}</nav>

    ${sectionHtml}

    <section class="risk">
      <strong>风险提示</strong>
      ${escapeHtml(report.risk_notice)}
    </section>
  </main>
</body>
</html>
`;
}
