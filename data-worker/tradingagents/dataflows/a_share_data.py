from contextlib import redirect_stdout
from datetime import datetime
from io import StringIO
import multiprocessing as mp
import os
import queue as queue_module
from typing import Optional

import pandas as pd
import requests


def a_share_code(symbol: str) -> Optional[str]:
    normalized = symbol.strip().upper()
    if normalized.endswith((".SS", ".SH", ".SZ")):
        normalized = normalized[:-3]
    if len(normalized) == 6 and normalized.isdigit() and normalized[0] in {"0", "2", "3", "6"}:
        return normalized
    return None


def is_a_share_symbol(symbol: str) -> bool:
    return a_share_code(symbol) is not None


def _column(frame: pd.DataFrame, candidates: list[str]) -> str:
    for candidate in candidates:
        if candidate in frame.columns:
            return candidate
    normalized = {
        str(column).strip().lower().replace(" ", "").replace("_", ""): column
        for column in frame.columns
    }
    for candidate in candidates:
        key = candidate.strip().lower().replace(" ", "").replace("_", "")
        if key in normalized:
            return str(normalized[key])
    raise KeyError(f"missing one of columns: {candidates}")


def _eastmoney_secid(code: str) -> str:
    market = "1" if code.startswith("6") else "0"
    return f"{market}.{code}"


def _baostock_symbol(code: str) -> str:
    return f"sh.{code}" if code.startswith("6") else f"sz.{code}"


def _normalize_ohlcv(data: pd.DataFrame) -> pd.DataFrame:
    if data.empty:
        return pd.DataFrame(columns=["Date", "Open", "High", "Low", "Close", "Adj Close", "Volume"])
    data["Date"] = pd.to_datetime(data["Date"], errors="coerce")
    for column in ["Open", "High", "Low", "Close", "Adj Close", "Volume"]:
        data[column] = pd.to_numeric(data[column], errors="coerce")
    data = data.dropna(subset=["Date", "Close"]).sort_values("Date")
    return data[["Date", "Open", "High", "Low", "Close", "Adj Close", "Volume"]].reset_index(drop=True)


def _configured_sources() -> list[str]:
    raw = os.getenv("TRADINGAGENTS_A_SHARE_PRICE_SOURCES", "baostock,eastmoney,akshare")
    aliases = {
        "bao": "baostock",
        "baostock": "baostock",
        "eastmoney": "eastmoney",
        "em": "eastmoney",
        "ak": "akshare",
        "akshare": "akshare",
    }
    sources = []
    for item in raw.split(","):
        source = aliases.get(item.strip().lower())
        if source and source not in sources:
            sources.append(source)
    return sources or ["baostock", "eastmoney", "akshare"]


def _source_timeout_seconds() -> float:
    try:
        return max(0.0, float(os.getenv("TRADINGAGENTS_A_SHARE_SOURCE_TIMEOUT", "20")))
    except ValueError:
        return 20.0


def _source_worker(source: str, symbol: str, start_date: str, end_date: str, queue):
    try:
        data = _load_source_direct(source, symbol, start_date, end_date)
        queue.put(("ok", data))
    except Exception as error:
        queue.put(("error", repr(error)))


def _load_source_direct(source: str, symbol: str, start_date: str, end_date: str) -> pd.DataFrame:
    loaders = {
        "baostock": get_baostock_ohlcv,
        "eastmoney": get_eastmoney_ohlcv,
        "akshare": get_akshare_native_ohlcv,
    }
    return loaders[source](symbol, start_date, end_date)


def _load_source_with_timeout(source: str, symbol: str, start_date: str, end_date: str) -> pd.DataFrame:
    timeout = _source_timeout_seconds()
    if timeout <= 0:
        return _load_source_direct(source, symbol, start_date, end_date)

    try:
        context = mp.get_context("fork")
    except ValueError:
        # Windows local development has no fork; keep direct calls there.
        return _load_source_direct(source, symbol, start_date, end_date)

    queue = context.Queue(maxsize=1)
    process = context.Process(target=_source_worker, args=(source, symbol, start_date, end_date, queue))
    process.start()
    try:
        status, payload = queue.get(timeout=timeout)
    except queue_module.Empty:
        process.terminate()
        process.join(2)
        raise TimeoutError(f"{source} A-share loader timed out after {timeout:.0f}s")
    finally:
        process.join(2)
        if process.is_alive():
            process.terminate()
            process.join(2)
    if status == "ok":
        return payload
    raise RuntimeError(str(payload))


def get_baostock_ohlcv(symbol: str, start_date: str, end_date: str) -> pd.DataFrame:
    code = a_share_code(symbol)
    if not code:
        raise ValueError(f"{symbol} is not an A-share symbol")

    import baostock as bs  # type: ignore

    with redirect_stdout(StringIO()):
        login_result = bs.login()
    try:
        if getattr(login_result, "error_code", "0") != "0":
            raise RuntimeError(getattr(login_result, "error_msg", "baostock login failed"))
        fields = "date,open,high,low,close,volume"
        result = bs.query_history_k_data_plus(
            _baostock_symbol(code),
            fields,
            start_date=start_date,
            end_date=end_date,
            frequency="d",
            adjustflag="3",
        )
        if result.error_code != "0":
            raise RuntimeError(result.error_msg)
        rows = []
        while result.next():
            rows.append(result.get_row_data())
        if not rows:
            return pd.DataFrame(columns=["Date", "Open", "High", "Low", "Close", "Adj Close", "Volume"])
        raw = pd.DataFrame(rows, columns=result.fields)
    finally:
        with redirect_stdout(StringIO()):
            bs.logout()

    data = pd.DataFrame({
        "Date": raw["date"],
        "Open": raw["open"],
        "High": raw["high"],
        "Low": raw["low"],
        "Close": raw["close"],
        "Adj Close": raw["close"],
        "Volume": raw["volume"],
    })
    return _normalize_ohlcv(data)


def get_eastmoney_ohlcv(symbol: str, start_date: str, end_date: str) -> pd.DataFrame:
    code = a_share_code(symbol)
    if not code:
        raise ValueError(f"{symbol} is not an A-share symbol")

    response = requests.get(
        "https://push2his.eastmoney.com/api/qt/stock/kline/get",
        params={
            "secid": _eastmoney_secid(code),
            "fields1": "f1,f2,f3,f4,f5,f6",
            "fields2": "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",
            "klt": "101",
            "fqt": "0",
            "beg": start_date.replace("-", ""),
            "end": end_date.replace("-", "")
        },
        timeout=15,
        headers={"User-Agent": "choose-a-share-research/0.1"},
    )
    response.raise_for_status()
    payload = response.json()
    klines = (payload.get("data") or {}).get("klines") or []
    if not klines:
        return pd.DataFrame(columns=["Date", "Open", "High", "Low", "Close", "Adj Close", "Volume"])

    rows = []
    for item in klines:
        fields = str(item).split(",")
        if len(fields) < 6:
            continue
        rows.append({
            "Date": fields[0],
            "Open": fields[1],
            "Close": fields[2],
            "High": fields[3],
            "Low": fields[4],
            "Volume": fields[5],
        })

    data = pd.DataFrame(rows)
    data["Adj Close"] = data["Close"]
    return _normalize_ohlcv(data)


def get_akshare_native_ohlcv(symbol: str, start_date: str, end_date: str) -> pd.DataFrame:
    code = a_share_code(symbol)
    if not code:
        raise ValueError(f"{symbol} is not an A-share symbol")

    try:
        import akshare as ak  # type: ignore
    except Exception:
        return pd.DataFrame(columns=["Date", "Open", "High", "Low", "Close", "Adj Close", "Volume"])

    try:
        raw = ak.stock_zh_a_hist(
            symbol=code,
            period="daily",
            start_date=start_date.replace("-", ""),
            end_date=end_date.replace("-", ""),
            adjust=""
        )
    except Exception:
        return pd.DataFrame(columns=["Date", "Open", "High", "Low", "Close", "Adj Close", "Volume"])
    if raw is None or raw.empty:
        return pd.DataFrame(columns=["Date", "Open", "High", "Low", "Close", "Adj Close", "Volume"])

    date_col = _column(raw, ["日期", "date", "Date"])
    open_col = _column(raw, ["开盘", "open", "Open"])
    high_col = _column(raw, ["最高", "high", "High"])
    low_col = _column(raw, ["最低", "low", "Low"])
    close_col = _column(raw, ["收盘", "close", "Close"])
    volume_col = _column(raw, ["成交量", "volume", "Volume"])

    data = pd.DataFrame({
        "Date": raw[date_col],
        "Open": raw[open_col],
        "High": raw[high_col],
        "Low": raw[low_col],
        "Close": raw[close_col],
        "Adj Close": raw[close_col],
        "Volume": raw[volume_col],
    })
    return _normalize_ohlcv(data)


def get_akshare_ohlcv(symbol: str, start_date: str, end_date: str) -> pd.DataFrame:
    code = a_share_code(symbol)
    if not code:
        raise ValueError(f"{symbol} is not an A-share symbol")

    for source in _configured_sources():
        try:
            data = _load_source_with_timeout(source, symbol, start_date, end_date)
            if not data.empty:
                return data
        except Exception:
            pass
    return pd.DataFrame(columns=["Date", "Open", "High", "Low", "Close", "Adj Close", "Volume"])


def format_akshare_stock_data(symbol: str, start_date: str, end_date: str) -> str:
    data = get_akshare_ohlcv(symbol, start_date, end_date)
    if data.empty:
        return f"No AKShare A-share data found for symbol '{symbol}' between {start_date} and {end_date}"

    output = data.copy()
    for column in ["Open", "High", "Low", "Close", "Adj Close"]:
        output[column] = output[column].round(2)
    output["Date"] = output["Date"].dt.strftime("%Y-%m-%d")
    output = output.set_index("Date")

    header = f"# A-share stock data for {symbol.upper()} from {start_date} to {end_date}\n"
    header += f"# Source priority: {', '.join(_configured_sources())}\n"
    header += f"# Total records: {len(output)}\n"
    header += f"# Data retrieved on: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n"

    return header + output.to_csv()
