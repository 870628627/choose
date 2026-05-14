import { db } from "./db.js";
import { runDataWorkerEvents, type DataWorkerEvent } from "./dataWorker.js";
import type { TradingAgentsReport } from "./types.js";

type ReportJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

type ReportJobRow = {
  id: number;
  user_id: number;
  asset_type: "a-share" | "us" | "crypto";
  code: string;
  symbol: string;
  display_name?: string | null;
  trade_date: string;
  status: ReportJobStatus;
  progress_percent: number;
  current_stage: string;
  error?: string | null;
  report_id?: number | null;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  updated_at: string;
};

const sectionSpecs = [
  { key: "market_report", title: "行情与技术面", order: 10, progress: 18 },
  { key: "sentiment_report", title: "市场情绪", order: 20, progress: 30 },
  { key: "news_report", title: "新闻与公告线索", order: 30, progress: 42 },
  { key: "fundamentals_report", title: "基本面研究", order: 40, progress: 54 },
  { key: "investment_debate", title: "多空辩论", order: 50, progress: 66 },
  { key: "research_plan", title: "研究经理交易摘要", order: 60, progress: 74 },
  { key: "trader_plan", title: "交易员方案", order: 70, progress: 82 },
  { key: "risk_debate", title: "风险团队辩论", order: 80, progress: 90 },
  { key: "risk_review", title: "风险经理结论", order: 90, progress: 95 },
  { key: "final_trade_decision", title: "最终交易决策", order: 100, progress: 98 }
];

const sectionByKey = new Map(sectionSpecs.map((section) => [section.key, section]));
const runningJobIds = new Set<number>();
const runningControllers = new Map<number, AbortController>();

function maxConcurrentJobs() {
  return Math.max(1, Number(process.env.TRADINGAGENTS_MAX_CONCURRENT_JOBS || 1));
}

function maxQueuedPerUser() {
  return Math.max(1, Number(process.env.TRADINGAGENTS_MAX_QUEUED_PER_USER || 3));
}

function tradingAgentsTimeoutMs() {
  return Number(process.env.TRADINGAGENTS_REPORT_TIMEOUT_MS || 900000);
}

function clampProgress(value: unknown, fallback: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function saveTradingReport(userId: number, assetType: string, report: TradingAgentsReport, displayName?: string | null) {
  const result = db
    .prepare(
      `
      INSERT INTO trading_reports (user_id, asset_type, symbol, display_name, trade_date, report_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `
    )
    .run(userId, assetType, report.symbol || report.code, displayName || null, report.trade_date, JSON.stringify(report));
  return Number(result.lastInsertRowid);
}

function reportRow(row: Record<string, unknown>) {
  const id = Number(row.id);
  const report = JSON.parse(String(row.report_json)) as TradingAgentsReport;
  return {
    id,
    asset_type: String(row.asset_type),
    symbol: String(row.symbol),
    display_name: row.display_name ? String(row.display_name) : "",
    trade_date: String(row.trade_date),
    created_at: String(row.created_at),
    report: { ...report, record_id: id }
  };
}

function getReportById(reportId?: number | null) {
  if (!reportId) return null;
  const row = db.prepare("SELECT * FROM trading_reports WHERE id = ? AND deleted_at IS NULL").get(reportId);
  return row ? reportRow(row as Record<string, unknown>) : null;
}

function getQueuePosition(row: ReportJobRow) {
  if (row.status !== "queued") return 0;
  const result = db
    .prepare("SELECT COUNT(*) AS count FROM report_jobs WHERE status = 'queued' AND id < ?")
    .get(row.id) as { count: number };
  return Number(result.count) + 1;
}

function buildJobSnapshot(row: ReportJobRow, options: { includeReportRecord?: boolean } = {}) {
  const includeReportRecord = options.includeReportRecord ?? true;
  const sections = db
    .prepare(
      `
      SELECT section_key, title, status, content, sort_order, started_at, completed_at, updated_at
      FROM report_job_sections
      WHERE job_id = ?
      ORDER BY sort_order ASC, id ASC
    `
    )
    .all(row.id);

  return {
    id: row.id,
    asset_type: row.asset_type,
    code: row.code,
    symbol: row.symbol,
    display_name: row.display_name || "",
    trade_date: row.trade_date,
    status: row.status,
    progress_percent: row.progress_percent,
    current_stage: row.current_stage,
    error: row.error || "",
    report_id: row.report_id || null,
    queue_position: getQueuePosition(row),
    created_at: row.created_at,
    started_at: row.started_at || "",
    completed_at: row.completed_at || "",
    updated_at: row.updated_at,
    sections,
    report_record: includeReportRecord ? getReportById(row.report_id) : null
  };
}

export function getReportJobForUser(jobId: number, userId: number) {
  const row = db.prepare("SELECT * FROM report_jobs WHERE id = ? AND user_id = ?").get(jobId, userId) as ReportJobRow | undefined;
  return row ? buildJobSnapshot(row) : null;
}

export function listReportJobsForUser(userId: number, assetType?: string) {
  const allowedTypes = new Set(["a-share", "us", "crypto"]);
  const rows = assetType && allowedTypes.has(assetType)
    ? db
      .prepare(
        `
        SELECT * FROM report_jobs
        WHERE user_id = ? AND asset_type = ? AND status != 'completed'
        ORDER BY created_at DESC, id DESC
        LIMIT 30
      `
      )
      .all(userId, assetType)
    : db
      .prepare(
        `
        SELECT * FROM report_jobs
        WHERE user_id = ? AND status != 'completed'
        ORDER BY created_at DESC, id DESC
        LIMIT 30
      `
      )
      .all(userId);

  return rows.map((row) => buildJobSnapshot(row as ReportJobRow, { includeReportRecord: false }));
}

export function cancelReportJobForUser(jobId: number, userId: number) {
  const row = db.prepare("SELECT * FROM report_jobs WHERE id = ? AND user_id = ?").get(jobId, userId) as ReportJobRow | undefined;
  if (!row) return null;

  if (row.status === "queued") {
    db.prepare(
      `
      UPDATE report_jobs
      SET status = 'cancelled',
          current_stage = '已停止',
          error = '用户停止了报告生成。',
          completed_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'queued'
    `
    ).run(jobId);
    setTimeout(pumpReportQueue, 0);
    return getReportJobForUser(jobId, userId);
  }

  if (row.status === "running") {
    db.prepare(
      `
      UPDATE report_jobs
      SET status = 'cancelled',
          current_stage = '已停止',
          error = '用户停止了报告生成，已生成的分段内容已保留。',
          completed_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'running'
    `
    ).run(jobId);
    runningControllers.get(jobId)?.abort();
    return getReportJobForUser(jobId, userId);
  }

  return buildJobSnapshot(row);
}

export function deleteReportJobForUser(jobId: number, userId: number) {
  const row = db.prepare("SELECT * FROM report_jobs WHERE id = ? AND user_id = ?").get(jobId, userId) as ReportJobRow | undefined;
  if (!row) return null;
  if (!["failed", "cancelled"].includes(row.status)) {
    const error = new Error("只能删除失败或已停止的报告任务。");
    (error as Error & { statusCode?: number }).statusCode = 409;
    throw error;
  }
  db.prepare("DELETE FROM report_jobs WHERE id = ? AND user_id = ?").run(jobId, userId);
  return { ok: true };
}

export function createReportJob(input: {
  userId: number;
  assetType: "a-share" | "us" | "crypto";
  code: string;
  symbol: string;
  displayName?: string | null;
  tradeDate?: string;
}) {
  const active = db
    .prepare("SELECT COUNT(*) AS count FROM report_jobs WHERE user_id = ? AND status IN ('queued', 'running')")
    .get(input.userId) as { count: number };

  if (Number(active.count) >= maxQueuedPerUser()) {
    const error = new Error(`当前账户已有 ${active.count} 个报告在排队或生成中，请等前面的任务完成后再提交。`);
    (error as Error & { statusCode?: number }).statusCode = 429;
    throw error;
  }

  const tradeDate = input.tradeDate || new Date().toISOString().slice(0, 10);
  const result = db
    .prepare(
      `
      INSERT INTO report_jobs (
        user_id, asset_type, code, symbol, display_name, trade_date,
        status, progress_percent, current_stage
      )
      VALUES (?, ?, ?, ?, ?, ?, 'queued', 1, '排队中')
    `
    )
    .run(input.userId, input.assetType, input.code, input.symbol, input.displayName || null, tradeDate);

  const jobId = Number(result.lastInsertRowid);
  const insertSection = db.prepare(
    `
    INSERT INTO report_job_sections (job_id, section_key, title, status, sort_order)
    VALUES (?, ?, ?, 'pending', ?)
  `
  );
  for (const section of sectionSpecs) {
    insertSection.run(jobId, section.key, section.title, section.order);
  }

  setTimeout(pumpReportQueue, 0);
  return getReportJobForUser(jobId, input.userId);
}

export function initializeReportJobQueue() {
  db.prepare(
    `
    UPDATE report_jobs
    SET status = 'failed',
        error = '服务重启，之前未完成的报告任务已终止，请重新提交。',
        current_stage = '已终止',
        completed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE status IN ('queued', 'running')
  `
  ).run();
  setTimeout(pumpReportQueue, 0);
}

function selectNextQueuedJob() {
  return db
    .prepare(
      `
      SELECT *
      FROM report_jobs
      WHERE status = 'queued'
        AND user_id NOT IN (
          SELECT user_id FROM report_jobs WHERE status = 'running'
        )
      ORDER BY id ASC
      LIMIT 1
    `
    )
    .get() as ReportJobRow | undefined;
}

function pumpReportQueue() {
  while (runningJobIds.size < maxConcurrentJobs()) {
    const row = selectNextQueuedJob();
    if (!row) return;
    runningJobIds.add(row.id);
    db.prepare(
      `
      UPDATE report_jobs
      SET status = 'running',
          progress_percent = 3,
          current_stage = '启动 TradingAgents',
          started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'queued'
    `
    ).run(row.id);
    void runReportJob(row).finally(() => {
      runningJobIds.delete(row.id);
      setTimeout(pumpReportQueue, 0);
    });
  }
}

function updateJobStage(jobId: number, stage: string, percent: number) {
  db.prepare(
    `
    UPDATE report_jobs
    SET current_stage = ?,
        progress_percent = MAX(progress_percent, ?),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'running'
  `
  ).run(stage, percent, jobId);
}

function updateJobSection(jobId: number, sectionKey: string, content: string, status = "completed", progress?: number) {
  const spec = sectionByKey.get(sectionKey);
  if (!spec) return;
  db.prepare(
    `
    INSERT INTO report_job_sections (
      job_id, section_key, title, status, content, sort_order, started_at, completed_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(job_id, section_key) DO UPDATE SET
      status = excluded.status,
      content = excluded.content,
      started_at = COALESCE(report_job_sections.started_at, CURRENT_TIMESTAMP),
      completed_at = CASE WHEN excluded.status = 'completed' THEN CURRENT_TIMESTAMP ELSE report_job_sections.completed_at END,
      updated_at = CURRENT_TIMESTAMP
  `
  ).run(jobId, sectionKey, spec.title, status, content, spec.order);

  updateJobStage(jobId, `已生成：${spec.title}`, progress ?? spec.progress);
}

function persistReportSections(jobId: number, report: TradingAgentsReport) {
  for (const [key, value] of Object.entries(report.sections)) {
    if (value) updateJobSection(jobId, key, String(value), "completed", 98);
  }
}

function handleWorkerEvent(row: ReportJobRow, event: DataWorkerEvent) {
  const latest = db.prepare("SELECT status FROM report_jobs WHERE id = ?").get(row.id) as { status: string } | undefined;
  if (latest?.status !== "running") return;

  if (event.type === "stage") {
    const stage = String(event.title || event.stage || row.current_stage || "运行中");
    updateJobStage(row.id, stage, clampProgress(event.percent, 5));
    return;
  }

  if (event.type === "section") {
    const sectionKey = String(event.section_key || "");
    const content = String(event.content || "");
    const status = String(event.status || "completed");
    updateJobSection(row.id, sectionKey, content, status, clampProgress(event.percent, sectionByKey.get(sectionKey)?.progress || 5));
    return;
  }

  if (event.type === "done") {
    const report = event.report as TradingAgentsReport | undefined;
    if (!report) return;
    const recordId = saveTradingReport(row.user_id, row.asset_type, report, row.display_name);
    persistReportSections(row.id, { ...report, record_id: recordId });
    db.prepare(
      `
      UPDATE report_jobs
      SET status = 'completed',
          progress_percent = 100,
          current_stage = '报告已完成',
          report_id = ?,
          completed_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `
    ).run(recordId, row.id);
  }
}

async function runReportJob(row: ReportJobRow) {
  const controller = new AbortController();
  runningControllers.set(row.id, controller);
  try {
    const args: Record<string, string> = { code: row.code };
    if (row.trade_date) args.trade_date = row.trade_date;
    await runDataWorkerEvents("run_tradingagents_report_events", args, (event) => handleWorkerEvent(row, event), {
      timeoutMs: tradingAgentsTimeoutMs(),
      signal: controller.signal
    });

    const latest = db.prepare("SELECT status FROM report_jobs WHERE id = ?").get(row.id) as { status: string } | undefined;
    if (latest?.status === "running") {
      throw new Error("报告 worker 结束但没有返回完成事件。");
    }
  } catch (error) {
    const latest = db.prepare("SELECT status FROM report_jobs WHERE id = ?").get(row.id) as { status: string } | undefined;
    if (latest?.status === "cancelled") return;
    db.prepare(
      `
      UPDATE report_jobs
      SET status = 'failed',
          current_stage = '生成失败',
          error = ?,
          completed_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'running'
    `
    ).run((error as Error).message.slice(0, 4000), row.id);
  } finally {
    runningControllers.delete(row.id);
  }
}
