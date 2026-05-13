"""A-share news and announcement fetchers for TradingAgents.

The upstream news tools are US-market oriented.  For A shares we combine
public exchange/company announcements with public Chinese finance pages and
search snippets.  This module does not log in, bypass captcha, or scrape
private feeds.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from functools import lru_cache
import logging
import re
import time
from typing import Any
from urllib.parse import quote_plus, urlparse

import requests
from parsel import Selector

from .a_share_data import a_share_code
from .a_share_fundamentals import fetch_a_share_announcements

logger = logging.getLogger(__name__)

_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)

_HEADERS = {
    "User-Agent": _UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7",
}

_A_SHARE_ALIASES = {
    "600519": "贵州茅台",
    "000001": "平安银行",
    "300750": "宁德时代",
    "601318": "中国平安",
    "600036": "招商银行",
    "000858": "五粮液",
    "002594": "比亚迪",
    "601899": "紫金矿业",
    "688981": "中芯国际",
}

_NEWS_TERMS = (
    "公告",
    "业绩",
    "财报",
    "营收",
    "净利润",
    "分红",
    "回购",
    "减持",
    "增持",
    "监管",
    "问询",
    "订单",
    "合同",
    "项目",
    "风险",
    "股东大会",
)


@dataclass
class PageCandidate:
    source: str
    url: str


def _market_prefix(code: str) -> str:
    return "SH" if code.startswith("6") else "SZ"


def _lower_market_prefix(code: str) -> str:
    return _market_prefix(code).lower()


def _normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def _safe_fetch(url: str, timeout: float = 6.0) -> str:
    try:
        response = requests.get(url, headers=_HEADERS, timeout=timeout)
        response.raise_for_status()
        return response.text
    except requests.RequestException as exc:
        logger.info("A-share news page fetch failed for %s: %s", url, exc)
        return ""


def _extract_page_text(html: str) -> tuple[str, str]:
    if not html:
        return "", ""
    selector = Selector(text=html)
    title = _normalize_text(selector.xpath("string(//title)").get() or "")
    meta_description = _normalize_text(
        selector.xpath("//meta[translate(@name, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')='description']/@content").get()
        or selector.xpath("//meta[translate(@property, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')='og:description']/@content").get()
        or ""
    )
    body_parts = selector.xpath("//body//text()[not(ancestor::script) and not(ancestor::style)]").getall()
    body = _normalize_text(" ".join(body_parts))
    return title, _normalize_text(f"{meta_description} {body}")


def _is_useful_fragment(fragment: str) -> bool:
    cjk_count = len(re.findall(r"[\u4e00-\u9fff]", fragment))
    if cjk_count < 8:
        return False
    alnum_count = len(re.findall(r"[A-Za-z0-9+/=]", fragment))
    return not (alnum_count > 120 and cjk_count < 20)


def _fragments(text: str, terms: list[str], limit: int = 5, radius: int = 100) -> list[str]:
    if not text:
        return []
    found: list[str] = []
    seen = set()
    for term in terms:
        if not term:
            continue
        for match in re.finditer(re.escape(term), text, flags=re.IGNORECASE):
            start = max(0, match.start() - radius)
            end = min(len(text), match.end() + radius)
            fragment = _normalize_text(text[start:end])
            key = fragment[:100]
            if fragment and _is_useful_fragment(fragment) and key not in seen:
                found.append(fragment[:320])
                seen.add(key)
            if len(found) >= limit:
                return found
    return found


def _worker_call(function_name: str, *args) -> Any:
    try:
        worker = __import__("worker", fromlist=[function_name])
        func = getattr(worker, function_name)
        return func(*args)
    except Exception as exc:
        logger.info("A-share worker helper %s failed: %s", function_name, exc)
        return None


@lru_cache(maxsize=256)
def _stock_name(code: str) -> str:
    basic = _worker_call("fetch_stock_basic", code)
    if isinstance(basic, dict) and basic.get("name"):
        return str(basic["name"])
    return _A_SHARE_ALIASES.get(code, "")


def _date_in_range(value: str, start_date: str, end_date: str) -> bool:
    try:
        current = datetime.strptime(value[:10], "%Y-%m-%d").date()
        start = datetime.strptime(start_date, "%Y-%m-%d").date()
        end = datetime.strptime(end_date, "%Y-%m-%d").date()
        return start <= current <= end
    except Exception:
        return True


@lru_cache(maxsize=256)
def _announcement_rows(code: str) -> tuple[tuple[tuple[str, str], ...], ...]:
    try:
        rows = fetch_a_share_announcements(code, limit=20)
    except Exception as exc:
        logger.info("direct A-share announcements failed for %s: %s", code, exc)
        rows = _worker_call("fetch_announcements", code)
    if not isinstance(rows, list) or not rows:
        return tuple()
    normalized_rows = []
    for row in rows:
        if isinstance(row, dict):
            normalized_rows.append(tuple(sorted((str(key), str(value)) for key, value in row.items())))
    return tuple(normalized_rows)


def _format_announcements(code: str, start_date: str, end_date: str, limit: int) -> list[str]:
    rows = [dict(row) for row in _announcement_rows(code)]
    if not rows:
        return ["<no public announcement rows returned from AKShare/Eastmoney/CNInfo helpers>"]

    recent = [
        row for row in rows
        if _date_in_range(str(row.get("published_at") or ""), start_date, end_date)
    ]
    selected = (recent or rows)[:limit]
    lines = []
    for row in selected:
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


def _direct_candidates(code: str) -> list[PageCandidate]:
    prefix = _lower_market_prefix(code)
    symbol = f"{_market_prefix(code)}{code}"
    return [
        PageCandidate("东方财富行情/资讯", f"https://quote.eastmoney.com/{prefix}{code}.html"),
        PageCandidate("同花顺个股新闻", f"https://stockpage.10jqka.com.cn/{code}/news/"),
        PageCandidate("新浪财经个股", f"https://finance.sina.com.cn/realstock/company/{prefix}{code}/nc.shtml"),
        PageCandidate("巨潮资讯公告", f"https://www.cninfo.com.cn/new/disclosure/stock?stockCode={code}"),
        PageCandidate("雪球个股页", f"https://xueqiu.com/S/{symbol}"),
    ]


def _scan_direct_pages(code: str, name: str) -> list[str]:
    terms = [code, name, f"{_market_prefix(code)}{code}", *_NEWS_TERMS]
    blocks = []
    for candidate in _direct_candidates(code):
        html = _safe_fetch(candidate.url)
        title, text = _extract_page_text(html)
        fragments = _fragments(text, terms)
        if not title and not fragments:
            continue
        lines = [f"### {candidate.source}", f"URL: {candidate.url}"]
        if title and title.lower() not in {"document", "404"}:
            lines.append(f"Title: {title[:180]}")
        if fragments:
            lines.append("Relevant public-page fragments:")
            lines.extend(f"- {fragment}" for fragment in fragments)
        else:
            lines.append("<page reachable, but no useful news fragment was found>")
        blocks.append("\n".join(lines))
        if len(blocks) >= 4:
            break
        time.sleep(0.25)
    return blocks


def _bing_search(query: str, timeout: float = 6.0) -> list[dict[str, str]]:
    html = _safe_fetch(f"https://www.bing.com/search?q={quote_plus(query)}&mkt=zh-CN", timeout=timeout)
    if not html:
        return []
    selector = Selector(text=html)
    results = []
    for item in selector.css("li.b_algo")[:8]:
        title = _normalize_text(" ".join(item.css("h2 ::text").getall()))
        href = item.css("h2 a::attr(href)").get() or ""
        snippet = _normalize_text(" ".join(item.css(".b_caption p ::text, p ::text").getall()))
        if title and href:
            results.append({"title": title[:180], "url": href, "snippet": snippet[:300]})
    return results


def _scan_search_snippets(code: str, name: str) -> list[str]:
    keyword = " ".join(part for part in [code, name, "股票 新闻 公告 财报"] if part)
    queries = [
        f"{keyword} site:finance.eastmoney.com",
        f"{keyword} site:stock.eastmoney.com",
        f"{keyword} site:stockpage.10jqka.com.cn",
        f"{keyword} site:finance.sina.com.cn",
        f"{keyword} site:cninfo.com.cn",
        f"{keyword} site:xueqiu.com",
    ]
    blocks = []
    seen_urls = set()
    for query in queries:
        results = _bing_search(query)
        lines = [f"### 搜索摘要：{query}"]
        used = 0
        for result in results:
            url = result["url"]
            if url in seen_urls:
                continue
            seen_urls.add(url)
            host = urlparse(url).netloc or "unknown"
            lines.append(f"- {result['title']} | {host} | {url} | {result['snippet'] or '<no snippet>'}")
            used += 1
            if used >= 3:
                break
        if used:
            blocks.append("\n".join(lines))
        if len(blocks) >= 4:
            break
        time.sleep(0.3)
    return blocks


def get_a_share_news(ticker: str, start_date: str, end_date: str, limit: int = 12) -> str:
    code = a_share_code(ticker)
    if not code:
        return f"<A-share news unavailable: {ticker} is not an A-share symbol>"

    name = _stock_name(code)
    direct_blocks = _scan_direct_pages(code, name)
    search_blocks = [] if len(direct_blocks) >= 3 else _scan_search_snippets(code, name)

    lines = [
        f"## A-share News Scan for {code}{f' / {name}' if name else ''}",
        f"Date window requested by agent: {start_date} to {end_date}",
        "Scope: public announcements, AKShare/Eastmoney announcement data, Chinese finance pages, and search snippets; no login-only feeds or captcha bypass.",
        "Announcement source policy: use the fast Eastmoney public announcement endpoint first; fall back to the AKShare announcement helper when that direct endpoint is unavailable.",
        "",
        "## Public Announcements / AKShare-compatible Eastmoney data",
        *_format_announcements(code, start_date, end_date, limit=min(limit, 10)),
    ]
    if direct_blocks:
        lines.append("\n## Public News Pages")
        lines.extend(direct_blocks)
    if search_blocks:
        lines.append("\n## Search Snippets")
        lines.extend(search_blocks)
    if not direct_blocks and not search_blocks:
        lines.append(
            "\n<no public news page snippets were found; announcements above are still usable as company-specific news evidence>"
        )
    return "\n".join(lines)
