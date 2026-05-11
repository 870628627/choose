const jsonHeaders = { "Content-Type": "application/json" };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "请求失败");
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
  syncLogs: () => request("/api/sync-logs"),
  dataQuality: () => request("/api/data-quality"),
  addNote: (code: string, author: string, content: string) =>
    request(`/api/stocks/${code}/notes`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ author, content })
    }),
  compare: (codes: string[]) => request(`/api/compare?codes=${codes.join(",")}`),
  risks: () => request("/api/risks"),
  reviews: () => request("/api/reviews"),
  addReview: (body: Record<string, unknown>) =>
    request("/api/reviews", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(body)
    })
};
