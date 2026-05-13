"""Sentiment analyst — multi-source sentiment analysis for a target ticker.

Previously named ``social_media_analyst``. Renamed and redesigned because
the old version had a prompt that demanded social-media analysis but the
only tool available was Yahoo Finance news — which led LLMs to fabricate
Reddit/X/StockTwits content under prompt pressure (verified live).

The redesigned agent pre-fetches three complementary data sources before
the LLM is invoked and injects them into the prompt as structured blocks:

  1. News headlines     — Yahoo Finance (institutional framing)
  2. StockTwits messages — retail-trader posts indexed by cashtag, with
                           user-labeled Bullish/Bearish sentiment tags
  3. Reddit posts        — r/wallstreetbets, r/stocks, r/investing

The agent does not use tool-calling; the data is in the prompt from
turn 0. The LLM produces the sentiment report in a single invocation.

See: https://github.com/TauricResearch/TradingAgents/issues/557
"""

from datetime import datetime, timedelta
import os

from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from tradingagents.agents.utils.agent_utils import (
    build_instrument_context,
    get_language_instruction,
    get_news,
)
from tradingagents.dataflows.a_share_data import is_a_share_symbol
from tradingagents.dataflows.a_share_sentiment import fetch_eastmoney_guba_posts
from tradingagents.dataflows.chinese_web_sentiment import fetch_chinese_us_stock_discussion
from tradingagents.dataflows.finnhub_sentiment import fetch_finnhub_social_sentiment
from tradingagents.dataflows.reddit import fetch_reddit_posts
from tradingagents.dataflows.stocktwits import fetch_stocktwits_messages


def _seven_days_back(trade_date: str) -> str:
    return (datetime.strptime(trade_date, "%Y-%m-%d") - timedelta(days=7)).strftime("%Y-%m-%d")


def _env_enabled(name: str, default: str = "0") -> bool:
    return os.getenv(name, default).strip().lower() in {"1", "true", "yes", "on"}


def create_sentiment_analyst(llm):
    """Create a sentiment analyst node for the trading graph.

    Pre-fetches news + StockTwits + Reddit data, injects them into the
    prompt as structured blocks, and produces a sentiment report in a
    single LLM call.
    """

    def sentiment_analyst_node(state):
        ticker = state["company_of_interest"]
        end_date = state["trade_date"]
        start_date = _seven_days_back(end_date)
        instrument_context = build_instrument_context(ticker)

        # Pre-fetch all three sources. Each fetcher degrades gracefully and
        # returns a string (no exceptions surface from here), so the LLM
        # always sees something — either real data or a clear placeholder.
        if is_a_share_symbol(ticker):
            news_block = (
                get_news.func(ticker, start_date, end_date)
                if _env_enabled("TRADINGAGENTS_ENABLE_SENTIMENT_YFINANCE_NEWS")
                else "<sentiment news prefetch disabled; A-share discussion uses Eastmoney Guba>"
            )
            guba_block = fetch_eastmoney_guba_posts(ticker, limit=30)
            system_message = _build_a_share_system_message(
                ticker=ticker,
                start_date=start_date,
                end_date=end_date,
                news_block=news_block,
                guba_block=guba_block,
            )
        else:
            finnhub_block = fetch_finnhub_social_sentiment(ticker, start_date, end_date)
            chinese_web_block = fetch_chinese_us_stock_discussion(ticker)
            if _env_enabled("TRADINGAGENTS_ENABLE_LEGACY_US_SOCIAL"):
                stocktwits_block = fetch_stocktwits_messages(ticker, limit=30, timeout=5.0)
                reddit_block = fetch_reddit_posts(ticker, limit_per_sub=2, timeout=5.0, inter_request_delay=0.2)
            else:
                stocktwits_block = "<StockTwits public scrape disabled by default; set TRADINGAGENTS_ENABLE_LEGACY_US_SOCIAL=1 to enable>"
                reddit_block = "<Reddit public scrape disabled by default; set TRADINGAGENTS_ENABLE_LEGACY_US_SOCIAL=1 to enable>"
            news_block = (
                get_news.func(ticker, start_date, end_date)
                if _env_enabled("TRADINGAGENTS_ENABLE_SENTIMENT_YFINANCE_NEWS")
                else "<Yahoo Finance news prefetch disabled in sentiment analyst; use the News analyst or Finnhub/news APIs for news>"
            )

            system_message = _build_system_message(
                ticker=ticker,
                start_date=start_date,
                end_date=end_date,
                finnhub_block=finnhub_block,
                chinese_web_block=chinese_web_block,
                news_block=news_block,
                stocktwits_block=stocktwits_block,
                reddit_block=reddit_block,
            )

        prompt = ChatPromptTemplate.from_messages(
            [
                (
                    "system",
                    "You are a helpful AI assistant, collaborating with other assistants."
                    " If you or any other assistant has the FINAL TRANSACTION PROPOSAL: **BUY/HOLD/SELL** or deliverable,"
                    " prefix your response with FINAL TRANSACTION PROPOSAL: **BUY/HOLD/SELL** so the team knows to stop."
                    "\n{system_message}\n"
                    "For your reference, the current date is {current_date}. {instrument_context}",
                ),
                MessagesPlaceholder(variable_name="messages"),
            ]
        )

        prompt = prompt.partial(system_message=system_message)
        prompt = prompt.partial(current_date=end_date)
        prompt = prompt.partial(instrument_context=instrument_context)

        # No bind_tools — the data is already in the prompt; a single LLM
        # call produces the report directly.
        chain = prompt | llm
        result = chain.invoke(state["messages"])

        return {
            "messages": [result],
            "sentiment_report": result.content,
        }

    return sentiment_analyst_node


def _build_system_message(
    *,
    ticker: str,
    start_date: str,
    end_date: str,
    finnhub_block: str,
    chinese_web_block: str,
    news_block: str,
    stocktwits_block: str,
    reddit_block: str,
) -> str:
    """Assemble the sentiment-analyst system message with structured data blocks."""
    return f"""You are a financial market sentiment analyst. Your task is to produce a comprehensive sentiment report for {ticker} covering the period from {start_date} to {end_date}, drawing on three complementary data sources that have already been collected for you.

## Data sources (pre-fetched, in this prompt)

### Finnhub social sentiment — preferred structured provider
Aggregated social sentiment signal. Prefer this section when it contains real rows because it comes from a normal API rather than direct public-site scraping.

<start_of_finnhub_social_sentiment>
{finnhub_block}
<end_of_finnhub_social_sentiment>

### Chinese public-web discussion — Xueqiu / Futu / Tiger / Eastmoney
Public Chinese investor discussion clues from reachable pages and search snippets. Treat this as a qualitative supplement, not a complete comment feed.

<start_of_chinese_public_web_discussion>
{chinese_web_block}
<end_of_chinese_public_web_discussion>

### News headlines — Yahoo Finance, past 7 days
Institutional framing. Fact-driven, slower-moving signal.

<start_of_news>
{news_block}
<end_of_news>

### StockTwits messages — retail-trader social platform indexed by cashtag
Fast-moving signal. Each message carries a user-labeled sentiment tag (Bullish / Bearish / no-label) plus the message body.

<start_of_stocktwits>
{stocktwits_block}
<end_of_stocktwits>

### Reddit posts — r/wallstreetbets, r/stocks, r/investing (past 7 days)
Community discussion. Engagement signal via upvote score and comment count. Subreddit character matters (r/wallstreetbets is often contrarian/exuberant; r/stocks more measured; r/investing longer-term).

<start_of_reddit>
{reddit_block}
<end_of_reddit>

## How to analyze this data (best practices)

1. **Use Finnhub as the preferred social-sentiment signal when available.** Evaluate mention counts, positive/negative mentions, and net score direction. Sample size matters — a strong score with very few mentions is weak evidence.

2. **Read the StockTwits Bullish/Bearish ratio as a direct retail-sentiment supplement.** A 70/30 bullish/bearish split is moderately bullish; ≥90/10 may indicate over-extension and contrarian risk; 50/50 is uncertainty. Sample size matters — base rates on the actual message count, not percentages alone.

3. **Use Chinese public-web discussion as a local-language retail lens.** It can surface Chinese investor narratives from Xueqiu/Futu/Tiger/Eastmoney, but it may be based on public snippets rather than full comment feeds. Mark confidence accordingly.

4. **Look for cross-source divergences.** If news framing is bearish but Finnhub/StockTwits/Chinese discussion is overwhelmingly bullish, that mismatch is itself a signal — it can mean retail is leaning into a thesis the news flow hasn't caught up to (or vice versa, that retail is chasing while institutions are cautious).

5. **Weight Reddit posts by engagement.** A 400-upvote / 200-comment thread reflects community attention; a 3-upvote post is noise. Read the body excerpts for context — the title alone often misleads.

6. **Distinguish opinion from event.** A news headline ("Nvidia announces $500M Corning deal") is an event; a StockTwits post ("buying NVDA, this is going to moon") is opinion. Both are inputs but should be weighted differently in your conclusions.

7. **Identify recurring narrative themes.** What topic keeps coming up across sources? That's the dominant narrative driving current sentiment.

8. **Be honest about data limits.** If Finnhub is unavailable, Chinese public-web scan only returned snippets, StockTwits returned only a handful of messages, or one or more sources returned an "<unavailable>" placeholder, the sentiment read is less robust — flag this caveat explicitly. If the sources are silent on a given subreddit, say so.

9. **Identify catalysts and risks** that emerge across sources — news of upcoming earnings, product launches, competitive threats, macro headlines, etc.

10. **Past sentiment is not predictive.** Frame your conclusions as signal for the trader to weigh alongside fundamentals and technicals, not as a price call.

## Output

Produce a sentiment report covering, in order:

1. **Overall sentiment direction** — Bullish / Bearish / Neutral / Mixed — with a brief confidence note based on data quality and sample size.
2. **Source-by-source breakdown** — what each of Finnhub / Chinese public web / news / StockTwits / Reddit is telling you, with specific evidence (cite mention counts, scores, snippets, ratios, notable posts).
3. **Divergences, alignments, and key narratives** across sources.
4. **Catalysts and risks** surfaced by the data.
5. **Markdown table** at the end summarizing key sentiment signals, their direction, source, and supporting evidence.

{get_language_instruction()}"""


def _build_a_share_system_message(
    *,
    ticker: str,
    start_date: str,
    end_date: str,
    news_block: str,
    guba_block: str,
) -> str:
    return f"""You are an A-share market sentiment analyst. Your task is to produce a comprehensive sentiment report for {ticker} covering the period from {start_date} to {end_date}.

## Data sources (pre-fetched, in this prompt)

### A-share discussion — Eastmoney Guba
Retail-investor discussion source. Treat it as noisy, fast-moving public-market opinion. Do not invent X, Reddit, or StockTwits evidence for A shares.

<start_of_eastmoney_guba>
{guba_block}
<end_of_eastmoney_guba>

### News headlines — configured news vendor
Use this block only when it contains real ticker-relevant headlines. If it is unavailable or sparse, say so clearly.

<start_of_news>
{news_block}
<end_of_news>

## How to analyze this data

1. Separate event facts from retail opinion.
2. Weight discussion by visible engagement and repeated themes, not by a single post.
3. Call out data gaps explicitly. If Eastmoney Guba or news data is unavailable, say the sentiment confidence is low.
4. Do not claim that public discussion predicts price. Frame it as one input beside technicals and fundamentals.

## Output

Produce a sentiment report covering:

1. Overall sentiment direction — Bullish / Bearish / Neutral / Mixed — with confidence based on source quality.
2. Eastmoney Guba themes and notable repeated narratives.
3. News/event themes when available.
4. Divergences, catalysts, and risks.
5. A markdown table summarizing signals, direction, source, and evidence.

{get_language_instruction()}"""


# ---------------------------------------------------------------------------
# Backwards-compatibility shim
# ---------------------------------------------------------------------------
def create_social_media_analyst(llm):
    """Deprecated alias for :func:`create_sentiment_analyst`.

    Kept so existing code that imports ``create_social_media_analyst``
    continues to work.

    .. deprecated::
        Import :func:`create_sentiment_analyst` directly instead.
    """
    import warnings
    warnings.warn(
        "create_social_media_analyst is deprecated and will be removed in a "
        "future version. Use create_sentiment_analyst instead.",
        DeprecationWarning,
        stacklevel=2,
    )
    return create_sentiment_analyst(llm)
