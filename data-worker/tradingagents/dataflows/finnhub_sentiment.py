"""Finnhub social sentiment fetcher.

Finnhub provides aggregated stock social sentiment through a normal HTTPS API,
which is more reliable on cloud servers than scraping public Reddit or
StockTwits endpoints directly.
"""

from __future__ import annotations

import logging
import os
from typing import Any

import requests

logger = logging.getLogger(__name__)

_API_URL = "https://finnhub.io/api/v1/stock/social-sentiment"
_UA = "alphascope/0.1"


def _fmt(value: Any) -> str:
    if value is None or value == "":
        return "-"
    if isinstance(value, float):
        return f"{value:.3f}"
    return str(value)


def _format_rows(source: str, rows: list[dict[str, Any]], limit: int) -> str:
    if not rows:
        return f"{source}: <no Finnhub rows returned>"

    lines = [f"{source}: {min(limit, len(rows))} Finnhub sentiment rows"]
    for row in rows[:limit]:
        at_time = row.get("atTime") or row.get("time") or "?"
        mention = row.get("mention")
        positive = row.get("positiveMention")
        negative = row.get("negativeMention")
        positive_score = row.get("positiveScore")
        negative_score = row.get("negativeScore")
        score = row.get("score")
        lines.append(
            "[{time}] mentions={mention}, positive_mentions={positive}, "
            "negative_mentions={negative}, positive_score={positive_score}, "
            "negative_score={negative_score}, net_score={score}".format(
                time=_fmt(at_time),
                mention=_fmt(mention),
                positive=_fmt(positive),
                negative=_fmt(negative),
                positive_score=_fmt(positive_score),
                negative_score=_fmt(negative_score),
                score=_fmt(score),
            )
        )
    return "\n".join(lines)


def fetch_finnhub_social_sentiment(ticker: str, start_date: str, end_date: str, limit: int = 14, timeout: float = 15.0) -> str:
    """Fetch Finnhub social sentiment and return a prompt-ready text block.

    The function intentionally returns explicit placeholders instead of raising,
    so report generation can continue when the key is missing, quota is reached,
    or Finnhub has no coverage for a symbol.
    """
    token = os.getenv("FINNHUB_API_KEY", "").strip()
    if not token:
        return "<finnhub unavailable: FINNHUB_API_KEY is not set>"

    symbol = ticker.strip().upper()
    if not symbol or "-" in symbol:
        return f"<finnhub unavailable: {symbol or ticker} is not a Finnhub stock symbol>"

    try:
        response = requests.get(
            _API_URL,
            params={"symbol": symbol, "from": start_date, "to": end_date, "token": token},
            headers={"User-Agent": _UA, "Accept": "application/json"},
            timeout=timeout,
        )
        if response.status_code in {401, 403}:
            return f"<finnhub unavailable: authentication failed or plan lacks access, HTTP {response.status_code}>"
        if response.status_code == 429:
            return "<finnhub unavailable: rate limited by Finnhub>"
        response.raise_for_status()
        payload = response.json()
    except requests.RequestException as exc:
        logger.warning("Finnhub social sentiment fetch failed for %s: %s", symbol, exc)
        return f"<finnhub unavailable: {type(exc).__name__}>"
    except ValueError as exc:
        logger.warning("Finnhub social sentiment JSON parse failed for %s: %s", symbol, exc)
        return "<finnhub unavailable: invalid JSON response>"

    if not isinstance(payload, dict):
        return "<finnhub unavailable: unexpected response shape>"

    reddit_rows = payload.get("reddit") if isinstance(payload.get("reddit"), list) else []
    twitter_rows = payload.get("twitter") if isinstance(payload.get("twitter"), list) else []
    if not reddit_rows and not twitter_rows:
        return f"<no Finnhub social sentiment rows found for {symbol} from {start_date} to {end_date}>"

    return "\n\n".join([
        f"Finnhub social sentiment for {symbol}, from {start_date} to {end_date}",
        _format_rows("Finnhub Reddit aggregate", reddit_rows, limit),
        _format_rows("Finnhub Twitter/X aggregate", twitter_rows, limit),
    ])
