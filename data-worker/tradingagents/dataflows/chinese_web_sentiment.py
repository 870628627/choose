"""Chinese public-web discussion scanner for US equities.

This module intentionally sticks to publicly accessible pages and search
snippets. It does not log in, bypass captcha, or scrape private feeds. The
result is a prompt-ready block that gives the sentiment analyst Chinese retail
discussion clues from sites such as Xueqiu, Futu, Tiger, and Eastmoney.
"""

from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass
from typing import Iterable
from urllib.parse import quote_plus, urlparse

import requests
from parsel import Selector

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

_COMPANY_ALIASES = {
    "NVDA": "英伟达",
    "AAPL": "苹果",
    "MSFT": "微软",
    "TSLA": "特斯拉",
    "AMZN": "亚马逊",
    "META": "Meta",
    "GOOGL": "谷歌",
    "GOOG": "谷歌",
    "AMD": "AMD",
    "AVGO": "博通",
    "PLTR": "Palantir",
    "SMCI": "超微电脑",
    "COIN": "Coinbase",
    "MSTR": "MicroStrategy",
    "NFLX": "奈飞",
    "BABA": "阿里巴巴",
    "NIO": "蔚来",
    "PDD": "拼多多",
    "BIDU": "百度",
}

_SENTIMENT_TERMS = (
    "看多", "看空", "上涨", "下跌", "买入", "卖出", "持有", "加仓", "减仓",
    "抄底", "回调", "突破", "财报", "估值", "风险", "利好", "利空", "泡沫",
    "人工智能", "芯片", "期权", "空头", "多头", "目标价",
)


@dataclass
class PageCandidate:
    source: str
    url: str


def _is_us_equity_symbol(ticker: str) -> bool:
    normalized = ticker.strip().upper()
    return bool(re.fullmatch(r"[A-Z][A-Z0-9.]{0,9}", normalized)) and "-" not in normalized


def _alias(ticker: str) -> str:
    return _COMPANY_ALIASES.get(ticker.strip().upper(), "")


def _normalize_text(text: str) -> str:
    text = re.sub(r"\s+", " ", text or "")
    return text.strip()


def _safe_fetch(url: str, timeout: float = 5.0) -> str:
    try:
        response = requests.get(url, headers=_HEADERS, timeout=timeout)
        response.raise_for_status()
        return response.text
    except requests.RequestException as exc:
        logger.info("Chinese public-web fetch failed for %s: %s", url, exc)
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
    if cjk_count < 4:
        return False
    alnum_count = len(re.findall(r"[A-Za-z0-9+/=]", fragment))
    if alnum_count > 90 and cjk_count < 12:
        return False
    return True


def _fragments(text: str, terms: Iterable[str], limit: int = 4, radius: int = 90) -> list[str]:
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
            key = fragment[:80]
            if fragment and _is_useful_fragment(fragment) and key not in seen:
                found.append(fragment[:260])
                seen.add(key)
            if len(found) >= limit:
                return found
    return found


def _direct_candidates(ticker: str) -> list[PageCandidate]:
    symbol = ticker.strip().upper()
    lower = symbol.lower()
    return [
        PageCandidate("雪球", f"https://ai.xueqiu.com/S/{symbol}"),
        PageCandidate("雪球", f"https://xueqiu.com/S/{symbol}"),
        PageCandidate("富途牛牛", f"https://www.futunn.com/stock/{symbol}-US"),
        PageCandidate("富途牛牛", f"https://www.futunn.com/hans/stock/{symbol}-US"),
        PageCandidate("老虎社区", f"https://www.laohu8.com/s/{symbol}"),
        PageCandidate("老虎社区", f"https://www.laohu8.com/m/hq/s/{symbol}/"),
        PageCandidate("东方财富美股吧", f"https://mguba.eastmoney.com/mguba/list/us{lower}"),
        PageCandidate("东方财富美股吧", f"https://guba.eastmoney.com/list,us{lower}.html"),
    ]


def _scan_direct_pages(ticker: str, terms: list[str]) -> list[str]:
    blocks = []
    for candidate in _direct_candidates(ticker):
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
        blocks.append("\n".join(lines))
        if len(blocks) >= 3:
            break
        time.sleep(0.3)
    return blocks


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


def _scan_search_snippets(ticker: str, alias: str) -> list[str]:
    terms = " ".join(part for part in [ticker, alias, "美股 讨论 评论 情绪"] if part)
    queries = [
        f"{terms} site:xueqiu.com",
        f"{terms} site:futunn.com",
        f"{terms} site:laohu8.com",
        f"{terms} site:mguba.eastmoney.com",
        f"{terms} site:guba.eastmoney.com",
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
        time.sleep(0.4)
    return blocks


def fetch_chinese_us_stock_discussion(ticker: str) -> str:
    """Return Chinese public-web discussion clues for a US equity ticker."""
    symbol = ticker.strip().upper()
    if not _is_us_equity_symbol(symbol):
        return f"<chinese public-web unavailable: {ticker} is not a simple US equity symbol>"

    alias = _alias(symbol)
    terms = [symbol, alias, *_SENTIMENT_TERMS]

    direct_blocks = _scan_direct_pages(symbol, terms)
    search_blocks = [] if len(direct_blocks) >= 3 else _scan_search_snippets(symbol, alias)

    if not direct_blocks and not search_blocks:
        return (
            f"<no Chinese public-web discussion snippets found for {symbol}; "
            "searched Xueqiu, Futu, Tiger, Eastmoney and Bing snippets>"
        )

    lines = [
        f"Chinese public-web discussion scan for {symbol}{f' / {alias}' if alias else ''}",
        "Scope: public pages and search snippets only; no login-only comments, no captcha bypass.",
    ]
    if direct_blocks:
        lines.append("\n## Public pages")
        lines.extend(direct_blocks)
    if search_blocks:
        lines.append("\n## Search snippets")
        lines.extend(search_blocks)
    return "\n\n".join(lines)
