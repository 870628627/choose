const jsonHeaders = { "Content-Type": "application/json" };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
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
  listStocks: () => request("/api/stocks"),
  addStock: (code: string) =>
    request("/api/stocks", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ code })
    }),
  deleteStock: (code: string) =>
    request(`/api/stocks/${code}`, {
      method: "DELETE"
    }),
  getStock: (code: string) => request(`/api/stocks/${code}`),
  sync: (code?: string) =>
    request("/api/sync", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(code ? { code } : {})
    }),
  tradingAgentsReport: (code: string) =>
    request(`/api/stocks/${code}/tradingagents-report`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({})
    }),
  tradingAgentsSymbolReport: (symbol: string) =>
    request("/api/tradingagents-report", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ symbol })
    })
};
