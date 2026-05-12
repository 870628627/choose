import os
from datetime import datetime, timezone
from io import StringIO
from typing import Optional

import pandas as pd
import requests


CRYPTO_IDS = {
    "BTC-USD": "bitcoin",
    "ETH-USD": "ethereum",
    "SOL-USD": "solana",
    "BNB-USD": "binancecoin",
    "XRP-USD": "ripple",
    "DOGE-USD": "dogecoin",
    "ADA-USD": "cardano",
}


def stooq_symbol(symbol: str) -> Optional[str]:
    normalized = symbol.strip().lower()
    if not normalized or "-" in normalized:
        return None
    if normalized.endswith(".us"):
        return normalized
    if "." in normalized:
        return None
    return f"{normalized}.us"


def has_market_fallback(symbol: str) -> bool:
    normalized = symbol.strip().upper()
    return normalized in CRYPTO_IDS or stooq_symbol(normalized) is not None


def is_crypto_symbol(symbol: str) -> bool:
    return symbol.strip().upper() in CRYPTO_IDS


def _empty_ohlcv() -> pd.DataFrame:
    return pd.DataFrame(columns=["Date", "Open", "High", "Low", "Close", "Adj Close", "Volume"])


def _normalize_ohlcv(data: pd.DataFrame) -> pd.DataFrame:
    if data.empty:
        return _empty_ohlcv()

    rename_map = {column: str(column).strip().title() for column in data.columns}
    data = data.rename(columns=rename_map)
    if "Date" not in data.columns:
        raise ValueError("market fallback data is missing Date column")

    data["Date"] = pd.to_datetime(data["Date"], errors="coerce")
    for column in ["Open", "High", "Low", "Close", "Volume"]:
        if column not in data.columns:
            raise ValueError(f"market fallback data is missing {column} column")
        data[column] = pd.to_numeric(data[column], errors="coerce")
    data["Adj Close"] = pd.to_numeric(data.get("Adj Close", data["Close"]), errors="coerce")
    data = data.dropna(subset=["Date", "Close"]).sort_values("Date")
    return data[["Date", "Open", "High", "Low", "Close", "Adj Close", "Volume"]].reset_index(drop=True)


def get_stooq_ohlcv(symbol: str, start_date: str, end_date: str) -> pd.DataFrame:
    ticker = stooq_symbol(symbol)
    if not ticker:
        raise ValueError(f"{symbol} is not a simple US equity symbol supported by Stooq fallback")

    api_key = os.getenv("STOOQ_API_KEY")
    if not api_key:
        raise ValueError("STOOQ_API_KEY is not set")

    response = requests.get(
        "https://stooq.com/q/d/l/",
        params={
            "s": ticker,
            "d1": start_date.replace("-", ""),
            "d2": end_date.replace("-", ""),
            "i": "d",
            "apikey": api_key,
        },
        timeout=15,
        headers={"User-Agent": "alphascope-market-research/0.1"},
    )
    response.raise_for_status()
    text = response.text.strip()
    if "No data" in text or not text:
        return _empty_ohlcv()
    first_line = text.splitlines()[0].strip().lower()
    if not first_line.startswith("date,open,high,low,close,volume"):
        raise ValueError(f"unexpected Stooq response for {symbol}: {text[:120]}")
    return _normalize_ohlcv(pd.read_csv(StringIO(text)))


def get_akshare_us_ohlcv(symbol: str, start_date: str, end_date: str) -> pd.DataFrame:
    ticker = symbol.strip().upper()
    if ticker.endswith(".US"):
        ticker = ticker[:-3]
    if not ticker or "." in ticker:
        raise ValueError(f"{symbol} is not a US equity symbol supported by AKShare fallback")

    import akshare as ak  # type: ignore

    raw = ak.stock_us_daily(symbol=ticker, adjust="qfq")
    if raw is None or raw.empty:
        return _empty_ohlcv()

    data = raw.rename(columns={
        "date": "Date",
        "open": "Open",
        "high": "High",
        "low": "Low",
        "close": "Close",
        "volume": "Volume",
    })
    data["Adj Close"] = data["Close"]
    data = _normalize_ohlcv(data)
    start_ts = pd.Timestamp(start_date)
    end_ts = pd.Timestamp(end_date)
    return data[(data["Date"] >= start_ts) & (data["Date"] <= end_ts)].reset_index(drop=True)


def _timestamp(date_str: str, end_of_day: bool = False) -> int:
    date_value = pd.Timestamp(date_str, tz=timezone.utc)
    if end_of_day:
        date_value = date_value + pd.Timedelta(days=1)
    return int(date_value.timestamp())


def get_coingecko_ohlcv(symbol: str, start_date: str, end_date: str) -> pd.DataFrame:
    coin_id = CRYPTO_IDS.get(symbol.strip().upper())
    if not coin_id:
        raise ValueError(f"{symbol} is not a supported crypto fallback symbol")

    response = requests.get(
        f"https://api.coingecko.com/api/v3/coins/{coin_id}/market_chart/range",
        params={
            "vs_currency": "usd",
            "from": _timestamp(start_date),
            "to": _timestamp(end_date, end_of_day=True),
        },
        timeout=15,
        headers={"User-Agent": "alphascope-market-research/0.1"},
    )
    response.raise_for_status()
    payload = response.json()
    prices = payload.get("prices") or []
    volumes = payload.get("total_volumes") or []
    if not prices:
        return _empty_ohlcv()

    price_frame = pd.DataFrame(prices, columns=["timestamp", "price"])
    price_frame["DateTime"] = pd.to_datetime(price_frame["timestamp"], unit="ms", utc=True)
    price_frame["Date"] = price_frame["DateTime"].dt.date

    volume_frame = pd.DataFrame(volumes, columns=["timestamp", "volume"])
    if not volume_frame.empty:
        volume_frame["DateTime"] = pd.to_datetime(volume_frame["timestamp"], unit="ms", utc=True)
        volume_frame["Date"] = volume_frame["DateTime"].dt.date
        daily_volume = volume_frame.groupby("Date")["volume"].sum()
    else:
        daily_volume = pd.Series(dtype=float)

    grouped = price_frame.groupby("Date")["price"]
    data = pd.DataFrame({
        "Date": pd.to_datetime(grouped.first().index),
        "Open": grouped.first().values,
        "High": grouped.max().values,
        "Low": grouped.min().values,
        "Close": grouped.last().values,
    })
    data["Adj Close"] = data["Close"]
    data["Volume"] = data["Date"].dt.date.map(daily_volume).fillna(0).astype(float)
    return _normalize_ohlcv(data)


def get_fallback_ohlcv(symbol: str, start_date: str, end_date: str) -> pd.DataFrame:
    normalized = symbol.strip().upper()
    if normalized in CRYPTO_IDS:
        return get_coingecko_ohlcv(normalized, start_date, end_date)
    try:
        return get_akshare_us_ohlcv(normalized, start_date, end_date)
    except Exception as akshare_error:
        try:
            return get_stooq_ohlcv(normalized, start_date, end_date)
        except Exception as stooq_error:
            raise RuntimeError(
                f"AKShare US fallback failed with {akshare_error}; Stooq fallback failed with {stooq_error}"
            ) from stooq_error


def format_fallback_stock_data(symbol: str, start_date: str, end_date: str) -> str:
    data = get_fallback_ohlcv(symbol, start_date, end_date)
    if data.empty:
        return f"No fallback market data found for symbol '{symbol}' between {start_date} and {end_date}"

    output = data.copy()
    for column in ["Open", "High", "Low", "Close", "Adj Close"]:
        output[column] = output[column].round(2)
    output["Date"] = output["Date"].dt.strftime("%Y-%m-%d")
    output = output.set_index("Date")

    source = "CoinGecko" if symbol.strip().upper() in CRYPTO_IDS else "AKShare US daily / Stooq"
    header = f"# Market data for {symbol.upper()} from {start_date} to {end_date}\n"
    header += f"# Source: {source}\n"
    header += f"# Total records: {len(output)}\n"
    header += f"# Data retrieved on: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n"
    return header + output.to_csv()
