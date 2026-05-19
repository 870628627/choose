"""yfinance-based news data fetching functions."""

from typing import Optional

import yfinance as yf
from datetime import datetime
from dateutil.relativedelta import relativedelta

from .config import get_config
from .stockstats_utils import yf_retry

_NEWS_CACHE: dict[tuple[str, int], list] = {}
_SEARCH_CACHE: dict[tuple[str, int], list] = {}


def _extract_article_data(article: dict) -> dict:
    """Extract article data from yfinance news format (handles nested 'content' structure)."""
    # Handle nested content structure
    if "content" in article:
        content = article["content"]
        title = content.get("title", "No title")
        summary = content.get("summary", "")
        provider = content.get("provider", {})
        publisher = provider.get("displayName", "Unknown")

        # Get URL from canonicalUrl or clickThroughUrl
        url_obj = content.get("canonicalUrl") or content.get("clickThroughUrl") or {}
        link = url_obj.get("url", "")

        # Get publish date
        pub_date_str = content.get("pubDate", "")
        pub_date = None
        if pub_date_str:
            try:
                pub_date = datetime.fromisoformat(pub_date_str.replace("Z", "+00:00"))
            except (ValueError, AttributeError):
                pass

        return {
            "title": title,
            "summary": summary,
            "publisher": publisher,
            "link": link,
            "pub_date": pub_date,
        }
    else:
        # Fallback for flat structure
        return {
            "title": article.get("title", "No title"),
            "summary": article.get("summary", ""),
            "publisher": article.get("publisher", "Unknown"),
            "link": article.get("link", ""),
            "pub_date": None,
        }


def get_news_yfinance(
    ticker: str,
    start_date: str,
    end_date: str,
) -> str:
    """
    Retrieve news for a specific stock ticker using yfinance.

    Args:
        ticker: Stock ticker symbol (e.g., "AAPL")
        start_date: Start date in yyyy-mm-dd format
        end_date: End date in yyyy-mm-dd format

    Returns:
        Formatted string containing news articles
    """
    article_limit = get_config()["news_article_limit"]
    try:
        cache_key = (ticker.upper(), article_limit)
        if cache_key not in _NEWS_CACHE:
            stock = yf.Ticker(ticker)
            _NEWS_CACHE[cache_key] = yf_retry(lambda: stock.get_news(count=article_limit))
        news = list(_NEWS_CACHE[cache_key])

        if not news:
            return f"## Yahoo Finance News: {ticker.upper()}\n\nYahoo Finance did not return news for this ticker."

        # Parse date range for filtering
        start_dt = datetime.strptime(start_date, "%Y-%m-%d")
        end_dt = datetime.strptime(end_date, "%Y-%m-%d")

        rows = []
        filtered_count = 0

        for article in news:
            data = _extract_article_data(article)

            # Filter by date if publish time is available
            if data["pub_date"]:
                pub_date_naive = data["pub_date"].replace(tzinfo=None)
                if not (start_dt <= pub_date_naive <= end_dt + relativedelta(days=1)):
                    continue

            publish_time = ""
            if data["pub_date"]:
                publish_time = data["pub_date"].strftime("%Y-%m-%d %H:%M")
            rows.append(
                f"### {filtered_count + 1}. {data['title']}\n\n"
                f"- Publisher: {data['publisher']}\n"
                f"- Published: {publish_time or 'Yahoo Finance 未返回该字段'}\n"
                f"- URL: {data['link'] or 'Yahoo Finance 未返回该字段'}\n\n"
                f"{data['summary'] or 'Yahoo Finance 未返回摘要。'}\n"
            )
            filtered_count += 1

        if filtered_count == 0:
            return f"## Yahoo Finance News: {ticker.upper()}\n\nNo Yahoo Finance news found between {start_date} and {end_date}."

        return (
            f"## Yahoo Finance News: {ticker.upper()}\n\n"
            f"- Source: Yahoo Finance / yfinance\n"
            f"- Range: {start_date} to {end_date}\n"
            f"- Articles: {filtered_count}\n\n"
            + "\n".join(rows)
        )

    except Exception as e:
        return f"## Yahoo Finance News: {ticker.upper()}\n\nYahoo Finance news request failed: {str(e)}"


def get_global_news_yfinance(
    curr_date: str,
    look_back_days: Optional[int] = None,
    limit: Optional[int] = None,
) -> str:
    """
    Retrieve global/macro economic news using yfinance Search.

    Args:
        curr_date: Current date in yyyy-mm-dd format
        look_back_days: Number of days to look back. ``None`` falls back to
            ``global_news_lookback_days`` from the active config.
        limit: Maximum number of articles to return. ``None`` falls back to
            ``global_news_article_limit`` from the active config.

    Returns:
        Formatted string containing global news articles
    """
    config = get_config()
    if look_back_days is None:
        look_back_days = config["global_news_lookback_days"]
    if limit is None:
        limit = config["global_news_article_limit"]
    search_queries = config["global_news_queries"]

    all_news = []
    seen_titles = set()

    try:
        for query in search_queries:
            cache_key = (query, limit)
            if cache_key not in _SEARCH_CACHE:
                search = yf_retry(lambda q=query: yf.Search(
                    query=q,
                    news_count=limit,
                    enable_fuzzy_query=True,
                ))
                _SEARCH_CACHE[cache_key] = list(search.news or [])
            search_news = _SEARCH_CACHE[cache_key]

            if search_news:
                for article in search_news:
                    # Handle both flat and nested structures
                    if "content" in article:
                        data = _extract_article_data(article)
                        title = data["title"]
                    else:
                        title = article.get("title", "")

                    # Deduplicate by title
                    if title and title not in seen_titles:
                        seen_titles.add(title)
                        all_news.append(article)

            if len(all_news) >= limit:
                break

        if not all_news:
            return f"## Yahoo Finance Global News\n\nNo global news found for {curr_date}."

        # Calculate date range
        curr_dt = datetime.strptime(curr_date, "%Y-%m-%d")
        start_dt = curr_dt - relativedelta(days=look_back_days)
        start_date = start_dt.strftime("%Y-%m-%d")

        rows = []
        for article in all_news[:limit]:
            # Handle both flat and nested structures
            if "content" in article:
                data = _extract_article_data(article)
                # Skip articles published after curr_date (look-ahead guard)
                if data.get("pub_date"):
                    pub_naive = data["pub_date"].replace(tzinfo=None) if hasattr(data["pub_date"], "replace") else data["pub_date"]
                    if pub_naive > curr_dt + relativedelta(days=1):
                        continue
                title = data["title"]
                publisher = data["publisher"]
                link = data["link"]
                summary = data["summary"]
            else:
                title = article.get("title", "No title")
                publisher = article.get("publisher", "Unknown")
                link = article.get("link", "")
                summary = ""

            rows.append(
                f"### {title}\n\n"
                f"- Publisher: {publisher}\n"
                f"- URL: {link or 'Yahoo Finance 未返回该字段'}\n\n"
                f"{summary or 'Yahoo Finance 未返回摘要。'}\n"
            )

        return (
            f"## Yahoo Finance Global Market News\n\n"
            f"- Source: Yahoo Finance / yfinance\n"
            f"- Range: {start_date} to {curr_date}\n\n"
            + "\n".join(rows)
        )

    except Exception as e:
        return f"## Yahoo Finance Global News\n\nYahoo Finance global news request failed: {str(e)}"
