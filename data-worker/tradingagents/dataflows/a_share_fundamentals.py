"""A-share fundamentals adapters for TradingAgents."""

from __future__ import annotations

from functools import lru_cache
import logging
from typing import Any

import requests

from .a_share_data import a_share_code

logger = logging.getLogger(__name__)

_HEADERS = {
    "User-Agent": "choose-a-share-research/0.1",
    "Accept": "application/json,text/plain,*/*",
    "Referer": "https://data.eastmoney.com/",
}


def _worker_call(function_name: str, *args) -> Any:
    try:
        worker = __import__("worker", fromlist=[function_name])
        func = getattr(worker, function_name)
        return func(*args)
    except Exception as exc:
        logger.info("A-share worker helper %s failed: %s", function_name, exc)
        return None


def _fmt(value: Any, suffix: str = "") -> str:
    if value is None or value == "":
        return "-"
    try:
        number = float(value)
        return f"{number:,.2f}{suffix}"
    except Exception:
        return f"{value}{suffix}"


def _to_float(value: Any) -> float | None:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except Exception:
        return None


def _market_suffix(code: str) -> str:
    if code.startswith("6"):
        return f"{code}.SH"
    if code.startswith(("0", "2", "3")):
        return f"{code}.SZ"
    if code.startswith(("4", "8")):
        return f"{code}.BJ"
    return code


def _eastmoney_financials(code: str) -> list[dict[str, Any]]:
    response = requests.get(
        "https://datacenter.eastmoney.com/securities/api/data/get",
        params={
            "type": "RPT_F10_FINANCE_MAINFINADATA",
            "sty": "APP_F10_MAINFINADATA",
            "quoteColumns": "",
            "filter": f'(SECUCODE="{_market_suffix(code)}")',
            "p": "1",
            "ps": "80",
            "sr": "-1",
            "st": "REPORT_DATE",
            "source": "HSF10",
            "client": "PC",
        },
        headers=_HEADERS,
        timeout=15,
    )
    response.raise_for_status()
    data = ((response.json() or {}).get("result") or {}).get("data") or []
    rows = []
    for row in data[:12]:
        report_period = str(row.get("REPORT_DATE", ""))[:10]
        if not report_period:
            continue
        rows.append({
            "report_period": report_period,
            "revenue": _to_float(row.get("TOTALOPERATEREVE")),
            "net_profit": _to_float(row.get("PARENTNETPROFIT")),
            "revenue_growth": _to_float(row.get("TOTALOPERATEREVETZ")),
            "net_profit_growth": _to_float(row.get("PARENTNETPROFITTZ")),
            "gross_margin": _to_float(row.get("XSMLL")),
            "net_margin": _to_float(row.get("XSJLL")),
            "roe": _to_float(row.get("ROEJQ")),
            "debt_asset_ratio": _to_float(row.get("ZCFZL")),
            "operating_cash_flow": _to_float(row.get("MGJYXJJE")),
            "source": "eastmoney-hsf10",
        })
    return rows


def fetch_a_share_announcements(code: str, limit: int = 20) -> list[dict[str, Any]]:
    response = requests.get(
        "https://np-anotice-stock.eastmoney.com/api/security/ann",
        params={
            "sr": "-1",
            "page_size": str(limit),
            "page_index": "1",
            "ann_type": "A",
            "client_source": "web",
            "f_node": "0",
            "s_node": "0",
            "stock_list": code,
        },
        headers=_HEADERS,
        timeout=15,
    )
    response.raise_for_status()
    data = ((response.json() or {}).get("data") or {}).get("list") or []
    rows = []
    for item in data[:limit]:
        title = str(item.get("title") or "").strip()
        if not title:
            continue
        columns = item.get("columns") or []
        codes = item.get("codes") or []
        column = columns[0] if columns and isinstance(columns[0], dict) else {}
        stock_code = code
        if codes and isinstance(codes[0], dict):
            stock_code = str(codes[0].get("stock_code") or code)
        art_code = str(item.get("art_code") or "").strip()
        url = f"https://data.eastmoney.com/notices/detail/{stock_code}/{art_code}.html" if art_code else ""
        rows.append({
            "title": title,
            "published_at": str(item.get("notice_date") or item.get("display_time") or "")[:10],
            "announcement_type": str(column.get("column_name") or "公告"),
            "url": url,
            "source": "eastmoney-announcement",
        })
    return rows


@lru_cache(maxsize=256)
def _basic(code: str) -> dict[str, Any]:
    value = _worker_call("fetch_stock_basic", code)
    if isinstance(value, dict):
        return value
    return {
        "code": code,
        "market": "SH" if code.startswith("6") else "SZ",
        "name": f"A股{code}",
        "industry": "未识别行业",
        "company_profile": "基础资料暂未从公开数据源返回。",
        "listing_date": "-",
    }


@lru_cache(maxsize=256)
def _daily(code: str) -> tuple[tuple[tuple[str, Any], ...], ...]:
    value = _worker_call("fetch_daily_metrics", code)
    return _freeze_rows(value)


@lru_cache(maxsize=256)
def _financials(code: str) -> tuple[tuple[tuple[str, Any], ...], ...]:
    try:
        rows = _eastmoney_financials(code)
        if rows:
            return _freeze_rows(rows)
    except Exception as exc:
        logger.info("direct Eastmoney financials failed for %s: %s", code, exc)
    value = _worker_call("fetch_financials", code)
    return _freeze_rows(value)


@lru_cache(maxsize=256)
def _announcements(code: str) -> tuple[tuple[tuple[str, Any], ...], ...]:
    try:
        rows = fetch_a_share_announcements(code)
        if rows:
            return _freeze_rows(rows)
    except Exception as exc:
        logger.info("direct Eastmoney announcements failed for %s: %s", code, exc)
    value = _worker_call("fetch_announcements", code)
    return _freeze_rows(value)


def _freeze_rows(value: Any) -> tuple[tuple[tuple[str, Any], ...], ...]:
    if not isinstance(value, list):
        return tuple()
    frozen = []
    for row in value:
        if isinstance(row, dict):
            frozen.append(tuple(sorted(row.items())))
    return tuple(frozen)


def _thaw_rows(rows: tuple[tuple[tuple[str, Any], ...], ...]) -> list[dict[str, Any]]:
    return [dict(row) for row in rows]


def _table(headers: list[str], rows: list[list[Any]]) -> list[str]:
    lines = [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join(["---"] * len(headers)) + " |",
    ]
    for row in rows:
        lines.append("| " + " | ".join(str(cell) for cell in row) + " |")
    return lines


def _format_daily(rows: list[dict[str, Any]], limit: int = 8) -> list[str]:
    if not rows:
        return ["<no A-share valuation/market daily metrics returned from baostock/AKShare>"]
    table_rows = []
    for row in rows[-limit:]:
        table_rows.append([
            row.get("trade_date") or "-",
            _fmt(row.get("close_price")),
            _fmt(row.get("pe_ttm")),
            _fmt(row.get("pb")),
            _fmt(row.get("ps")),
            _fmt(row.get("turnover_rate"), "%"),
            row.get("source") or "-",
        ])
    return _table(["日期", "收盘", "PE(TTM)", "PB", "PS", "换手率", "来源"], table_rows)


def _format_financials(rows: list[dict[str, Any]], limit: int = 8) -> list[str]:
    if not rows:
        return ["<no A-share financial indicator rows returned from AKShare/Eastmoney>"]
    table_rows = []
    for row in rows[:limit]:
        table_rows.append([
            row.get("report_period") or "-",
            _fmt(row.get("revenue")),
            _fmt(row.get("net_profit")),
            _fmt(row.get("revenue_growth"), "%"),
            _fmt(row.get("net_profit_growth"), "%"),
            _fmt(row.get("gross_margin"), "%"),
            _fmt(row.get("net_margin"), "%"),
            _fmt(row.get("roe"), "%"),
            _fmt(row.get("debt_asset_ratio"), "%"),
            row.get("source") or "-",
        ])
    return _table(
        ["报告期", "营收", "归母净利", "营收同比", "净利同比", "毛利率", "净利率", "ROE", "资产负债率", "来源"],
        table_rows,
    )


def _format_announcements(rows: list[dict[str, Any]], limit: int = 8) -> list[str]:
    if not rows:
        return ["<no recent public announcement rows returned>"]
    lines = []
    for row in rows[:limit]:
        title = str(row.get("title") or "").strip()
        if not title:
            continue
        published_at = str(row.get("published_at") or "?")[:10]
        kind = str(row.get("announcement_type") or "公告").strip()
        source = str(row.get("source") or "public").strip()
        url = str(row.get("url") or "").strip()
        suffix = f" | {url}" if url else ""
        lines.append(f"- {published_at} | {kind} | {title} | {source}{suffix}")
    return lines or ["<announcement source returned rows, but no usable title/date fields were found>"]


def get_a_share_fundamentals(ticker: str, curr_date: str | None = None) -> str:
    code = a_share_code(ticker)
    if not code:
        return f"<A-share fundamentals unavailable: {ticker} is not an A-share symbol>"

    basic = _basic(code)
    daily = _thaw_rows(_daily(code))
    financials = _thaw_rows(_financials(code))
    announcements = _thaw_rows(_announcements(code))

    lines = [
        f"## A-share Fundamentals for {code} / {basic.get('name', '-')}",
        f"Current date requested by agent: {curr_date or '-'}",
        "Data scope: public A-share basics, baostock/AKShare valuation snapshots, Eastmoney financial indicators, and public announcements.",
        "",
        "## Company Profile",
        f"- Market: {basic.get('market', '-')}",
        f"- Industry: {basic.get('industry', '-')}",
        f"- Listing date: {basic.get('listing_date', '-')}",
        f"- Business profile: {basic.get('company_profile', '-')}",
        "",
        "## Recent Valuation / Market Metrics",
        *_format_daily(daily),
        "",
        "## Financial Indicator History",
        *_format_financials(financials),
        "",
        "## Recent Public Announcements",
        *_format_announcements(announcements),
        "",
        "Note: free public A-share sources often expose financial indicators more reliably than a fully normalized US-style statement schema.",
    ]
    return "\n".join(lines)


def get_a_share_balance_sheet(ticker: str, freq: str = "quarterly", curr_date: str | None = None) -> str:
    code = a_share_code(ticker)
    if not code:
        return f"<A-share balance sheet unavailable: {ticker} is not an A-share symbol>"
    rows = _thaw_rows(_financials(code))
    lines = [
        f"## A-share Balance-Sheet Proxy for {code}",
        f"Frequency requested: {freq}; current date: {curr_date or '-'}",
        "The public adapter returns balance-sheet-related indicators instead of a complete standardized statement.",
    ]
    if not rows:
        lines.append("<no balance-sheet-related indicators returned from public sources>")
        return "\n".join(lines)
    table_rows = [
        [
            row.get("report_period") or "-",
            _fmt(row.get("debt_asset_ratio"), "%"),
            _fmt(row.get("roe"), "%"),
            row.get("source") or "-",
        ]
        for row in rows[:10]
    ]
    lines.extend(_table(["报告期", "资产负债率", "ROE", "来源"], table_rows))
    return "\n".join(lines)


def get_a_share_cashflow(ticker: str, freq: str = "quarterly", curr_date: str | None = None) -> str:
    code = a_share_code(ticker)
    if not code:
        return f"<A-share cash flow unavailable: {ticker} is not an A-share symbol>"
    rows = _thaw_rows(_financials(code))
    lines = [
        f"## A-share Cash-Flow Proxy for {code}",
        f"Frequency requested: {freq}; current date: {curr_date or '-'}",
        "The public adapter uses available operating-cash-flow indicators when the source provides them.",
    ]
    if not rows:
        lines.append("<no cash-flow-related indicators returned from public sources>")
        return "\n".join(lines)
    table_rows = [
        [
            row.get("report_period") or "-",
            _fmt(row.get("operating_cash_flow")),
            _fmt(row.get("net_profit")),
            row.get("source") or "-",
        ]
        for row in rows[:10]
    ]
    lines.extend(_table(["报告期", "经营现金流", "归母净利", "来源"], table_rows))
    return "\n".join(lines)


def get_a_share_income_statement(ticker: str, freq: str = "quarterly", curr_date: str | None = None) -> str:
    code = a_share_code(ticker)
    if not code:
        return f"<A-share income statement unavailable: {ticker} is not an A-share symbol>"
    rows = _thaw_rows(_financials(code))
    lines = [
        f"## A-share Income-Statement Proxy for {code}",
        f"Frequency requested: {freq}; current date: {curr_date or '-'}",
        "The public adapter returns income-statement-related indicators from Eastmoney/AKShare.",
    ]
    if not rows:
        lines.append("<no income-statement-related indicators returned from public sources>")
        return "\n".join(lines)
    table_rows = [
        [
            row.get("report_period") or "-",
            _fmt(row.get("revenue")),
            _fmt(row.get("net_profit")),
            _fmt(row.get("revenue_growth"), "%"),
            _fmt(row.get("net_profit_growth"), "%"),
            _fmt(row.get("gross_margin"), "%"),
            _fmt(row.get("net_margin"), "%"),
            row.get("source") or "-",
        ]
        for row in rows[:10]
    ]
    lines.extend(_table(["报告期", "营收", "归母净利", "营收同比", "净利同比", "毛利率", "净利率", "来源"], table_rows))
    return "\n".join(lines)
