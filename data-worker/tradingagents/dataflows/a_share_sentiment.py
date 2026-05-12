"""A-share market-discussion fetchers.

The upstream TradingAgents sentiment analyst was designed around US-market
sources such as StockTwits and Reddit. For A shares those sources are usually
silent, so we use Eastmoney Guba via AKShare as the first local discussion
source and degrade to an explicit placeholder when it is unavailable.
"""

from __future__ import annotations

import logging
from typing import Any

from .a_share_data import a_share_code

logger = logging.getLogger(__name__)


def _pick(row: Any, *names: str) -> str:
    for name in names:
        try:
            value = row.get(name)
        except Exception:
            value = None
        if value is not None and str(value).strip():
            return str(value).replace("\n", " ").strip()
    return ""


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
