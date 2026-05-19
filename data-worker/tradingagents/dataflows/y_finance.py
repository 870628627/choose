from typing import Annotated
from datetime import datetime
from dateutil.relativedelta import relativedelta
import pandas as pd
import yfinance as yf
import os
from .a_share_data import format_akshare_stock_data, is_a_share_symbol
from .market_fallback_data import format_fallback_stock_data, has_market_fallback, is_crypto_symbol
from .stockstats_utils import StockstatsUtils, _clean_dataframe, yf_retry, load_ohlcv, filter_financials_by_date

_TICKER_CACHE: dict[str, yf.Ticker] = {}
_HISTORY_CACHE: dict[tuple[str, str, str], pd.DataFrame] = {}
_INFO_CACHE: dict[str, dict] = {}
_STATEMENT_CACHE: dict[tuple[str, str, str], pd.DataFrame] = {}


def _ticker(symbol: str) -> yf.Ticker:
    normalized = symbol.strip().upper()
    if normalized not in _TICKER_CACHE:
        _TICKER_CACHE[normalized] = yf.Ticker(normalized)
    return _TICKER_CACHE[normalized]


def _history(symbol: str, start_date: str, end_date: str) -> pd.DataFrame:
    key = (symbol.strip().upper(), start_date, end_date)
    if key not in _HISTORY_CACHE:
        _HISTORY_CACHE[key] = yf_retry(
            lambda: _ticker(key[0]).history(start=start_date, end=end_date)
        )
    return _HISTORY_CACHE[key].copy()


def _ticker_info(symbol: str) -> dict:
    normalized = symbol.strip().upper()
    if normalized not in _INFO_CACHE:
        info = yf_retry(lambda: _ticker(normalized).info)
        _INFO_CACHE[normalized] = info or {}
    return dict(_INFO_CACHE[normalized])


def _statement(symbol: str, statement: str, freq: str) -> pd.DataFrame:
    normalized = symbol.strip().upper()
    normalized_freq = freq.lower()
    key = (normalized, statement, normalized_freq)
    if key not in _STATEMENT_CACHE:
        ticker_obj = _ticker(normalized)
        if statement == "balance_sheet":
            loader = lambda: ticker_obj.quarterly_balance_sheet if normalized_freq == "quarterly" else ticker_obj.balance_sheet
        elif statement == "cashflow":
            loader = lambda: ticker_obj.quarterly_cashflow if normalized_freq == "quarterly" else ticker_obj.cashflow
        elif statement == "income_statement":
            loader = lambda: ticker_obj.quarterly_income_stmt if normalized_freq == "quarterly" else ticker_obj.income_stmt
        else:
            raise ValueError(f"Unsupported Yahoo Finance statement: {statement}")
        _STATEMENT_CACHE[key] = yf_retry(loader)
    return _STATEMENT_CACHE[key].copy()


def _format_number(value) -> str:
    if value is None or pd.isna(value):
        return "Yahoo Finance 未返回该字段"
    if isinstance(value, (int, float)):
        abs_value = abs(value)
        if abs_value >= 1_000_000_000:
            return f"{value / 1_000_000_000:.2f}B"
        if abs_value >= 1_000_000:
            return f"{value / 1_000_000:.2f}M"
        if 0 < abs_value < 1:
            return f"{value:.4f}"
        return f"{value:,.2f}"
    return str(value)


def _dataframe_to_markdown(data: pd.DataFrame, max_rows: int | None = None) -> str:
    frame = data.head(max_rows).copy() if max_rows else data.copy()
    columns = [str(column) for column in frame.columns]
    rows = ["| " + " | ".join(columns) + " |"]
    rows.append("| " + " | ".join(["---"] * len(columns)) + " |")
    for _, row in frame.iterrows():
        rows.append("| " + " | ".join(str(row[column]) for column in frame.columns) + " |")
    if max_rows and len(data) > max_rows:
        rows.append(f"\n... {len(data) - max_rows} more rows omitted from tool context.")
    return "\n".join(rows)


def _format_ohlcv_output(symbol: str, start_date: str, end_date: str, data: pd.DataFrame, source: str) -> str:
    output = data.copy()
    if getattr(output.index, "tz", None) is not None:
        output.index = output.index.tz_localize(None)
    if "Date" not in output.columns:
        output = output.reset_index()
    if "Date" not in output.columns and "Datetime" in output.columns:
        output = output.rename(columns={"Datetime": "Date"})
    required = ["Date", "Open", "High", "Low", "Close", "Volume"]
    missing = [column for column in required if column not in output.columns]
    if missing:
        return (
            f"## Yahoo Finance price data unavailable for {symbol.upper()}\n\n"
            f"Missing columns: {', '.join(missing)}"
        )
    output = output[required].copy()
    output["Date"] = pd.to_datetime(output["Date"], errors="coerce").dt.strftime("%Y-%m-%d")
    for column in ["Open", "High", "Low", "Close"]:
        output[column] = pd.to_numeric(output[column], errors="coerce").round(2)
    output["Volume"] = pd.to_numeric(output["Volume"], errors="coerce").fillna(0).astype("int64")

    latest = output.dropna(subset=["Date", "Close"]).tail(1)
    summary = ""
    if not latest.empty:
        row = latest.iloc[0]
        summary = f"- Latest close: {row['Close']} on {row['Date']}\n- Latest volume: {row['Volume']}\n"

    return (
        f"## Price Data: {symbol.upper()}\n\n"
        f"- Source: {source}\n"
        f"- Range: {start_date} to {end_date}\n"
        f"- Records: {len(output)}\n"
        f"- Retrieved at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
        f"{summary}\n"
        f"### OHLCV\n\n"
        f"{_dataframe_to_markdown(output)}"
    )


def _format_statement_output(ticker: str, title: str, freq: str, curr_date: str | None, data: pd.DataFrame) -> str:
    data = filter_financials_by_date(data, curr_date)
    if data.empty:
        return (
            f"## {title}: {ticker.upper()} ({freq})\n\n"
            f"Yahoo Finance did not return {title.lower()} data for this ticker."
        )
    output = data.copy()
    output.columns = [
        column.strftime("%Y-%m-%d") if hasattr(column, "strftime") else str(column)
        for column in output.columns
    ]
    output = output.reset_index().rename(columns={"index": "Line Item"})
    for column in output.columns:
        if column != "Line Item":
            output[column] = output[column].map(_format_number)

    return (
        f"## {title}: {ticker.upper()} ({freq})\n\n"
        f"- Source: Yahoo Finance / yfinance\n"
        f"- Look-ahead guard date: {curr_date or 'not provided'}\n"
        f"- Retrieved at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n"
        f"{_dataframe_to_markdown(output, max_rows=40)}"
    )

def get_YFin_data_online(
    symbol: Annotated[str, "ticker symbol of the company"],
    start_date: Annotated[str, "Start date in yyyy-mm-dd format"],
    end_date: Annotated[str, "End date in yyyy-mm-dd format"],
):

    datetime.strptime(start_date, "%Y-%m-%d")
    datetime.strptime(end_date, "%Y-%m-%d")

    if is_a_share_symbol(symbol):
        try:
            return format_akshare_stock_data(symbol, start_date, end_date)
        except Exception as e:
            return f"Error retrieving A-share stock data for {symbol}: {str(e)}"

    if is_crypto_symbol(symbol):
        try:
            return format_fallback_stock_data(symbol, start_date, end_date)
        except Exception as fallback_error:
            print(f"Fallback market data failed for {symbol}: {fallback_error}")

    try:
        data = _history(symbol, start_date, end_date)
    except Exception as error:
        if has_market_fallback(symbol):
            try:
                return format_fallback_stock_data(symbol, start_date, end_date)
            except Exception as fallback_error:
                return (
                    f"Error retrieving market data for {symbol}: Yahoo Finance failed with {error}; "
                    f"fallback source failed with {fallback_error}"
                )
        return f"Error retrieving Yahoo Finance stock data for {symbol}: {error}"

    if data.empty:
        if has_market_fallback(symbol):
            try:
                return format_fallback_stock_data(symbol, start_date, end_date)
            except Exception as fallback_error:
                return (
                    f"No Yahoo Finance data found for symbol '{symbol}' between {start_date} and {end_date}; "
                    f"fallback source failed with {fallback_error}"
                )
        return f"No Yahoo Finance data found for symbol '{symbol}' between {start_date} and {end_date}"

    return _format_ohlcv_output(symbol, start_date, end_date, data, "Yahoo Finance / yfinance")

def get_stock_stats_indicators_window(
    symbol: Annotated[str, "ticker symbol of the company"],
    indicator: Annotated[str, "technical indicator to get the analysis and report of"],
    curr_date: Annotated[
        str, "The current trading date you are trading on, YYYY-mm-dd"
    ],
    look_back_days: Annotated[int, "how many days to look back"],
) -> str:

    best_ind_params = {
        # Moving Averages
        "close_50_sma": (
            "50 SMA: A medium-term trend indicator. "
            "Usage: Identify trend direction and serve as dynamic support/resistance. "
            "Tips: It lags price; combine with faster indicators for timely signals."
        ),
        "close_200_sma": (
            "200 SMA: A long-term trend benchmark. "
            "Usage: Confirm overall market trend and identify golden/death cross setups. "
            "Tips: It reacts slowly; best for strategic trend confirmation rather than frequent trading entries."
        ),
        "close_10_ema": (
            "10 EMA: A responsive short-term average. "
            "Usage: Capture quick shifts in momentum and potential entry points. "
            "Tips: Prone to noise in choppy markets; use alongside longer averages for filtering false signals."
        ),
        # MACD Related
        "macd": (
            "MACD: Computes momentum via differences of EMAs. "
            "Usage: Look for crossovers and divergence as signals of trend changes. "
            "Tips: Confirm with other indicators in low-volatility or sideways markets."
        ),
        "macds": (
            "MACD Signal: An EMA smoothing of the MACD line. "
            "Usage: Use crossovers with the MACD line to trigger trades. "
            "Tips: Should be part of a broader strategy to avoid false positives."
        ),
        "macdh": (
            "MACD Histogram: Shows the gap between the MACD line and its signal. "
            "Usage: Visualize momentum strength and spot divergence early. "
            "Tips: Can be volatile; complement with additional filters in fast-moving markets."
        ),
        # Momentum Indicators
        "rsi": (
            "RSI: Measures momentum to flag overbought/oversold conditions. "
            "Usage: Apply 70/30 thresholds and watch for divergence to signal reversals. "
            "Tips: In strong trends, RSI may remain extreme; always cross-check with trend analysis."
        ),
        # Volatility Indicators
        "boll": (
            "Bollinger Middle: A 20 SMA serving as the basis for Bollinger Bands. "
            "Usage: Acts as a dynamic benchmark for price movement. "
            "Tips: Combine with the upper and lower bands to effectively spot breakouts or reversals."
        ),
        "boll_ub": (
            "Bollinger Upper Band: Typically 2 standard deviations above the middle line. "
            "Usage: Signals potential overbought conditions and breakout zones. "
            "Tips: Confirm signals with other tools; prices may ride the band in strong trends."
        ),
        "boll_lb": (
            "Bollinger Lower Band: Typically 2 standard deviations below the middle line. "
            "Usage: Indicates potential oversold conditions. "
            "Tips: Use additional analysis to avoid false reversal signals."
        ),
        "atr": (
            "ATR: Averages true range to measure volatility. "
            "Usage: Set stop-loss levels and adjust position sizes based on current market volatility. "
            "Tips: It's a reactive measure, so use it as part of a broader risk management strategy."
        ),
        # Volume-Based Indicators
        "vwma": (
            "VWMA: A moving average weighted by volume. "
            "Usage: Confirm trends by integrating price action with volume data. "
            "Tips: Watch for skewed results from volume spikes; use in combination with other volume analyses."
        ),
        "mfi": (
            "MFI: The Money Flow Index is a momentum indicator that uses both price and volume to measure buying and selling pressure. "
            "Usage: Identify overbought (>80) or oversold (<20) conditions and confirm the strength of trends or reversals. "
            "Tips: Use alongside RSI or MACD to confirm signals; divergence between price and MFI can indicate potential reversals."
        ),
    }

    if indicator not in best_ind_params:
        raise ValueError(
            f"Indicator {indicator} is not supported. Please choose from: {list(best_ind_params.keys())}"
        )

    end_date = curr_date
    curr_date_dt = datetime.strptime(curr_date, "%Y-%m-%d")
    before = curr_date_dt - relativedelta(days=look_back_days)

    # Optimized: Get stock data once and calculate indicators for all dates
    try:
        indicator_data = _get_stock_stats_bulk(symbol, indicator, curr_date)
        
        # Generate the date range we need
        current_dt = curr_date_dt
        date_values = []
        
        while current_dt >= before:
            date_str = current_dt.strftime('%Y-%m-%d')
            
            # Look up the indicator value for this date
            if date_str in indicator_data:
                indicator_value = indicator_data[date_str]
            else:
                indicator_value = "N/A: Not a trading day (weekend or holiday)"
            
            date_values.append((date_str, indicator_value))
            current_dt = current_dt - relativedelta(days=1)
        
        # Build the result string
        ind_string = ""
        for date_str, value in date_values:
            ind_string += f"{date_str}: {value}\n"
        
    except Exception as e:
        print(f"Error getting bulk stockstats data: {e}")
        if is_a_share_symbol(symbol) or has_market_fallback(symbol):
            ind_string = f"Unable to retrieve OHLCV data for {symbol}: {e}\n"
            result_str = (
                f"## {indicator} values from {before.strftime('%Y-%m-%d')} to {end_date}:\n\n"
                + ind_string
                + "\n\n"
                + best_ind_params.get(indicator, "No description available.")
            )
            return result_str
        # Fallback to original implementation if bulk method fails
        ind_string = ""
        curr_date_dt = datetime.strptime(curr_date, "%Y-%m-%d")
        while curr_date_dt >= before:
            indicator_value = get_stockstats_indicator(
                symbol, indicator, curr_date_dt.strftime("%Y-%m-%d")
            )
            ind_string += f"{curr_date_dt.strftime('%Y-%m-%d')}: {indicator_value}\n"
            curr_date_dt = curr_date_dt - relativedelta(days=1)

    result_str = (
        f"## {indicator} values from {before.strftime('%Y-%m-%d')} to {end_date}:\n\n"
        + ind_string
        + "\n\n"
        + best_ind_params.get(indicator, "No description available.")
    )

    return result_str


def _get_stock_stats_bulk(
    symbol: Annotated[str, "ticker symbol of the company"],
    indicator: Annotated[str, "technical indicator to calculate"],
    curr_date: Annotated[str, "current date for reference"]
) -> dict:
    """
    Optimized bulk calculation of stock stats indicators.
    Fetches data once and calculates indicator for all available dates.
    Returns dict mapping date strings to indicator values.
    """
    from stockstats import wrap

    data = load_ohlcv(symbol, curr_date)
    df = wrap(data)
    df["Date"] = df["Date"].dt.strftime("%Y-%m-%d")
    
    # Calculate the indicator for all rows at once
    df[indicator]  # This triggers stockstats to calculate the indicator
    
    # Create a dictionary mapping date strings to indicator values
    result_dict = {}
    for _, row in df.iterrows():
        date_str = row["Date"]
        indicator_value = row[indicator]
        
        # Handle NaN/None values
        if pd.isna(indicator_value):
            result_dict[date_str] = "N/A"
        else:
            result_dict[date_str] = str(indicator_value)
    
    return result_dict


def get_stockstats_indicator(
    symbol: Annotated[str, "ticker symbol of the company"],
    indicator: Annotated[str, "technical indicator to get the analysis and report of"],
    curr_date: Annotated[
        str, "The current trading date you are trading on, YYYY-mm-dd"
    ],
) -> str:

    curr_date_dt = datetime.strptime(curr_date, "%Y-%m-%d")
    curr_date = curr_date_dt.strftime("%Y-%m-%d")

    try:
        indicator_value = StockstatsUtils.get_stock_stats(
            symbol,
            indicator,
            curr_date,
        )
    except Exception as e:
        print(
            f"Error getting stockstats indicator data for indicator {indicator} on {curr_date}: {e}"
        )
        return ""

    return str(indicator_value)


def get_fundamentals(
    ticker: Annotated[str, "ticker symbol of the company"],
    curr_date: Annotated[str, "current date (not used for yfinance)"] = None
):
    """Get company fundamentals overview from yfinance."""
    try:
        info = _ticker_info(ticker)

        if not info:
            return f"## Fundamentals: {ticker.upper()}\n\nYahoo Finance did not return fundamentals data for this ticker."

        fields = [
            ("Company Name", info.get("longName") or info.get("shortName")),
            ("Sector", info.get("sector")),
            ("Industry", info.get("industry")),
            ("Market Cap", info.get("marketCap")),
            ("PE Ratio (TTM)", info.get("trailingPE")),
            ("Forward PE", info.get("forwardPE")),
            ("EPS (TTM)", info.get("trailingEps")),
            ("Forward EPS", info.get("forwardEps")),
            ("Return on Equity", info.get("returnOnEquity")),
            ("Gross Margin", info.get("grossMargins")),
            ("Profit Margin", info.get("profitMargins")),
            ("Dividend Yield", info.get("dividendYield")),
            ("52 Week High", info.get("fiftyTwoWeekHigh")),
            ("52 Week Low", info.get("fiftyTwoWeekLow")),
            ("Beta", info.get("beta")),
            ("Total Revenue", info.get("totalRevenue")),
            ("Net Income", info.get("netIncomeToCommon")),
            ("EBITDA", info.get("ebitda")),
            ("Free Cash Flow", info.get("freeCashflow")),
            ("Operating Margin", info.get("operatingMargins")),
            ("Return on Assets", info.get("returnOnAssets")),
            ("Debt to Equity", info.get("debtToEquity")),
            ("Current Ratio", info.get("currentRatio")),
        ]

        table = pd.DataFrame(
            [{"Metric": label, "Value": _format_number(value)} for label, value in fields]
        )

        return (
            f"## Fundamentals: {ticker.upper()}\n\n"
            f"- Source: Yahoo Finance / yfinance\n"
            f"- Retrieved at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n"
            f"### Key Metrics\n\n"
            f"{_dataframe_to_markdown(table)}"
        )

    except Exception as e:
        return f"## Fundamentals: {ticker.upper()}\n\nYahoo Finance fundamentals request failed: {str(e)}"


def get_balance_sheet(
    ticker: Annotated[str, "ticker symbol of the company"],
    freq: Annotated[str, "frequency of data: 'annual' or 'quarterly'"] = "quarterly",
    curr_date: Annotated[str, "current date in YYYY-MM-DD format"] = None
):
    """Get balance sheet data from yfinance."""
    try:
        data = _statement(ticker, "balance_sheet", freq)
        return _format_statement_output(ticker, "Balance Sheet", freq, curr_date, data)
        
    except Exception as e:
        return f"## Balance Sheet: {ticker.upper()} ({freq})\n\nYahoo Finance balance sheet request failed: {str(e)}"


def get_cashflow(
    ticker: Annotated[str, "ticker symbol of the company"],
    freq: Annotated[str, "frequency of data: 'annual' or 'quarterly'"] = "quarterly",
    curr_date: Annotated[str, "current date in YYYY-MM-DD format"] = None
):
    """Get cash flow data from yfinance."""
    try:
        data = _statement(ticker, "cashflow", freq)
        return _format_statement_output(ticker, "Cash Flow", freq, curr_date, data)
        
    except Exception as e:
        return f"## Cash Flow: {ticker.upper()} ({freq})\n\nYahoo Finance cash flow request failed: {str(e)}"


def get_income_statement(
    ticker: Annotated[str, "ticker symbol of the company"],
    freq: Annotated[str, "frequency of data: 'annual' or 'quarterly'"] = "quarterly",
    curr_date: Annotated[str, "current date in YYYY-MM-DD format"] = None
):
    """Get income statement data from yfinance."""
    try:
        data = _statement(ticker, "income_statement", freq)
        return _format_statement_output(ticker, "Income Statement", freq, curr_date, data)
        
    except Exception as e:
        return f"## Income Statement: {ticker.upper()} ({freq})\n\nYahoo Finance income statement request failed: {str(e)}"


def get_insider_transactions(
    ticker: Annotated[str, "ticker symbol of the company"]
):
    """Get insider transactions data from yfinance."""
    try:
        ticker_obj = yf.Ticker(ticker.upper())
        data = yf_retry(lambda: ticker_obj.insider_transactions)
        
        if data is None or data.empty:
            return f"No insider transactions data found for symbol '{ticker}'"
            
        # Convert to CSV string for consistency with other functions
        csv_string = data.to_csv()
        
        # Add header information
        header = f"# Insider Transactions data for {ticker.upper()}\n"
        header += f"# Data retrieved on: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n"
        
        return header + csv_string
        
    except Exception as e:
        return f"Error retrieving insider transactions for {ticker}: {str(e)}"
