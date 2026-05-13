import type { AuthSession, AuthUser, ReportJob, ReportRecord, StockDetail, StockListItem } from "./types";

const jsonHeaders = { "Content-Type": "application/json" };
const tokenKey = "alphascope_token";

let authToken = typeof window === "undefined" ? "" : window.localStorage.getItem(tokenKey) || "";

export function setAuthToken(token: string) {
  authToken = token;
  if (typeof window === "undefined") return;
  if (token) {
    window.localStorage.setItem(tokenKey, token);
  } else {
    window.localStorage.removeItem(tokenKey);
  }
}

export function getAuthToken() {
  return authToken;
}

function headersWithAuth(init?: RequestInit) {
  const headers = new Headers(init?.headers || {});
  if (authToken) headers.set("Authorization", `Bearer ${authToken}`);
  return headers;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: headersWithAuth(init) });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json().catch(() => ({}))
    : {};
  const fallbackText = response.ok || contentType.includes("application/json")
    ? ""
    : await response.text().catch(() => "");
  if (!response.ok) {
    const payloadError = typeof payload === "object" && payload && "error" in payload ? String(payload.error) : "";
    throw new Error(payloadError || fallbackText.slice(0, 200) || `请求失败（HTTP ${response.status}）`);
  }
  return payload as T;
}

export const api = {
  register: (email: string, password: string) =>
    request<AuthSession>("/api/auth/register", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ email, password })
    }),
  login: (email: string, password: string) =>
    request<AuthSession>("/api/auth/login", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ email, password })
    }),
  logout: () =>
    request<{ ok: true }>("/api/auth/logout", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({})
    }),
  me: () => request<{ user: AuthUser }>("/api/auth/me"),
  reports: (assetType?: ReportRecord["asset_type"]) =>
    request<ReportRecord[]>(assetType ? `/api/reports?asset_type=${encodeURIComponent(assetType)}` : "/api/reports"),
  reportJobs: (assetType?: ReportRecord["asset_type"]) =>
    request<ReportJob[]>(assetType ? `/api/report-jobs?asset_type=${encodeURIComponent(assetType)}` : "/api/report-jobs"),
  reportJob: (id: number) => request<ReportJob>(`/api/report-jobs/${id}`),
  deleteReport: (id: number) =>
    request<{ ok: true }>(`/api/reports/${id}`, {
      method: "DELETE"
    }),
  listStocks: () => request<StockListItem[]>("/api/stocks"),
  addStock: (code: string) =>
    request<{ id: number; code: string }>("/api/stocks", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ code })
    }),
  deleteStock: (code: string) =>
    request<{ ok: true }>(`/api/stocks/${code}`, {
      method: "DELETE"
    }),
  getStock: (code: string) => request<StockDetail>(`/api/stocks/${code}`),
  sync: (code?: string) =>
    request<{ synced: number; message?: string }>("/api/sync", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(code ? { code } : {})
    }),
  tradingAgentsReport: (code: string) =>
    request<ReportJob>(`/api/stocks/${code}/tradingagents-report`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({})
    }),
  tradingAgentsSymbolReport: (symbol: string) =>
    request<ReportJob>("/api/tradingagents-report", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ symbol })
    })
};
