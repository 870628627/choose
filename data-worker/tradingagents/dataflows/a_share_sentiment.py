"""A-share market-discussion fetchers.

The upstream TradingAgents sentiment analyst was designed around US-market
sources such as StockTwits and Reddit. For A shares those sources are usually
silent, so we combine Eastmoney Guba with public Chinese web pages and search
snippets from Eastmoney, Xueqiu, and Tonghuashun. This module only reads
publicly reachable pages; it does not log in, bypass captcha, or scrape
private feeds.
"""

from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote_plus, urlparse

import requests
from parsel import Selector

from .a_share_data import a_share_code

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

_DISCUSSION_TERMS = (
    "看多", "看空", "上涨", "下跌", "买入", "卖出", "持有", "加仓", "减仓",
    "抄底", "回调", "突破", "财报", "估值", "风险", "利好", "利空", "主力",
    "资金", "散户", "机构", "股吧", "研报", "分红", "业绩", "龙虎榜",
)


@dataclass
class PageCandidate:
    source: str
    url: str


def _pick(row: Any, *names: str) -> str:
    for name in names:
        try:
            value = row.get(name)
        except Exception:
            value = None
        if value is not None and str(value).strip():
            return str(value).replace("\n", " ").strip()
    return ""


def _market_prefix(code: str) -> str:
    return "SH" if code.startswith("6") else "SZ"


def _alias(code: str) -> str:
    return _A_SHARE_ALIASES.get(code, "")


def _normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def _safe_fetch(url: str, timeout: float = 5.0) -> str:
    try:
        response = requests.get(url, headers=_HEADERS, timeout=timeout)
        response.raise_for_status()
        return response.text
    except requests.RequestException as exc:
        logger.info("A-share public-web fetch failed for %s: %s", url, exc)
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
    if cjk_count < 6:
        return False
    alnum_count = len(re.findall(r"[A-Za-z0-9+/=]", fragment))
    if alnum_count > 90 and cjk_count < 16:
        return False
    return True


def _fragments(text: str, terms: list[str], limit: int = 4, radius: int = 90) -> list[str]:
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
            key = fragment[:90]
            if fragment and _is_useful_fragment(fragment) and key not in seen:
                found.append(fragment[:280])
                seen.add(key)
            if len(found) >= limit:
                return found
    return found


def _direct_candidates(code: str) -> list[PageCandidate]:
    symbol = f"{_market_prefix(code)}{code}"
    lower_symbol = symbol.lower()
    return [
        PageCandidate("东方财富股吧", f"https://guba.eastmoney.com/list,{code}.html"),
        PageCandidate("东方财富股吧", f"https://mguba.eastmoney.com/mguba/list/{code}"),
        PageCandidate("雪球", f"https://xueqiu.com/S/{symbol}"),
        PageCandidate("雪球", f"https://ai.xueqiu.com/S/{symbol}"),
        PageCandidate("同花顺", f"https://stockpage.10jqka.com.cn/{code}/"),
        PageCandidate("同花顺股吧", f"https://guba.10jqka.com.cn/{lower_symbol}/"),
    ]


def _scan_direct_pages(code: str, terms: list[str]) -> list[str]:
    fragment_blocks = []
    reachable_blocks = []
    for candidate in _direct_candidates(code):
        html = _safe_fetch(candidate.url)
        title, text = _extract_page_text(html)
        fragments = _fragments(text, terms)
        useful_title = title and title.lower() not in {"document", "404"}
        if not useful_title and not fragments:
            continue
        lines = [f"### {candidate.source}", f"URL: {candidate.url}"]
        if useful_title:
            lines.append(f"Title: {title[:160]}")
        if fragments:
            lines.append("Relevant public-page fragments:")
            lines.extend(f"- {fragment}" for fragment in fragments)
        else:
            lines.append("<page reachable, but no useful discussion fragment was found>")
        if fragments:
            fragment_blocks.append("\n".join(lines))
        else:
            reachable_blocks.append("\n".join(lines))
        if len(fragment_blocks) >= 4:
            break
        time.sleep(0.25)
    return (fragment_blocks + reachable_blocks)[:4]


def _bing_search(query: str, timeout: float = 5.0) -> list[dict[str, str]]:
    html = _safe_fetch(f"https://www.bing.com/search?q={quote_plus(query)}&mkt=zh-CN", timeout=timeout)
    if not html:
        return []
    selector = Selector(text=html)
    results = []
    for item in selector.css("li.b_algo")[:6]:
        title = _normalize_text(" ".join(item.css("h2 ::text").getall()))
        href = item.css("h2 a::attr(href)").get() or ""
        snippet = _normalize_text(" ".join(item.css(".b_caption p ::text, p ::text").getall()))
        if title and href:
            results.append({"title": title[:180], "url": href, "snippet": snippet[:280]})
    return results


def _scan_search_snippets(code: str, alias: str) -> list[str]:
    terms = " ".join(part for part in [code, alias, "A股 股吧 讨论 情绪"] if part)
    queries = [
        f"{terms} site:guba.eastmoney.com",
        f"{terms} site:mguba.eastmoney.com",
        f"{terms} site:xueqiu.com",
        f"{terms} site:10jqka.com.cn",
        f"{terms} site:guba.10jqka.com.cn",
    ]
    blocks = []
    seen_hosts = set()
    for query in queries:
        results = _bing_search(query)
        if not results:
            continue
        lines = [f"### 搜索摘要：{query}"]
        used = 0
        for result in results:
            host = urlparse(result["url"]).netloc
            if host in seen_hosts and used >= 2:
                continue
            seen_hosts.add(host)
            lines.append(f"- {result['title']} | {result['url']} | {result['snippet'] or '<no snippet>'}")
            used += 1
            if used >= 3:
                break
        if used:
            blocks.append("\n".join(lines))
        if len(blocks) >= 4:
            break
        time.sleep(0.3)
    return blocks


def fetch_eastmoney_guba_posts(symbol: str, limit: int = 30) -> str:
    code = a_share_code(symbol)
    if not code:
        return f"<eastmoney guba unavailable: {symbol} is not an A-share symbol>"

    try:
        import akshare as ak  # type: ignore

        frame = ak.stock_guba_em(symbol=code)
    except Exception as exc:
        logger.warning("Eastmoney Guba fetch failed for %s: %s", symbol, exc)
        return f"<eastmoney guba unavailable: {type(exc).__name__}>"

    if frame is None or frame.empty:
        return f"<no Eastmoney Guba posts found for {code}>"

    lines = [f"Eastmoney Guba — {min(limit, len(frame))} recent posts for {code}:"]
    for _, row in frame.head(limit).iterrows():
        title = _pick(row, "标题", "帖子标题", "post_title")
        author = _pick(row, "作者", "用户", "post_author") or "?"
        published_at = _pick(row, "更新时间", "发布时间", "最后更新", "post_last_time") or "?"
        read_count = _pick(row, "阅读", "阅读数", "post_click_count")
        comment_count = _pick(row, "评论", "评论数", "post_comment_count")
        if not title:
            continue
        engagement = " / ".join(part for part in [f"{read_count} read" if read_count else "", f"{comment_count} comments" if comment_count else ""] if part)
        suffix = f" · {engagement}" if engagement else ""
        lines.append(f"[{published_at} · {author}{suffix}] {title}")

    if len(lines) == 1:
        return f"<Eastmoney Guba returned rows for {code}, but no usable post titles were found>"
    return "\n".join(lines)


def fetch_a_share_public_discussion(symbol: str, limit: int = 30) -> str:
    code = a_share_code(symbol)
    if not code:
        return f"<A-share public discussion unavailable: {symbol} is not an A-share symbol>"

    alias = _alias(code)
    terms = [code, alias, f"{_market_prefix(code)}{code}", *_DISCUSSION_TERMS]
    eastmoney_block = fetch_eastmoney_guba_posts(symbol, limit=limit)
    direct_blocks = _scan_direct_pages(code, terms)
    search_blocks = [] if len(direct_blocks) >= 3 else _scan_search_snippets(code, alias)

    lines = [
        f"A-share public discussion scan for {code}{f' / {alias}' if alias else ''}",
        "Scope: public pages and search snippets only; no login-only comments, no captcha bypass.",
        "\n## Eastmoney Guba API / AKShare",
        eastmoney_block,
    ]
    if direct_blocks:
        lines.append("\n## Public pages")
        lines.extend(direct_blocks)
    if search_blocks:
        lines.append("\n## Search snippets")
        lines.extend(search_blocks)
    if not direct_blocks and not search_blocks and eastmoney_block.startswith("<"):
        lines.append(
            f"\n<no A-share public discussion snippets found for {code}; "
            "searched Eastmoney Guba, Xueqiu, Tonghuashun and Bing snippets>"
        )
    return "\n\n".join(lines)
