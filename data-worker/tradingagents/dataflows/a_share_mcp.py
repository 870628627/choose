"""Runtime MCP adapters for A-share market data."""

from __future__ import annotations

import json
import os
import subprocess
import threading
from datetime import datetime
from typing import Any

import pandas as pd

_EMPTY_OHLCV_COLUMNS = ["Date", "Open", "High", "Low", "Close", "Adj Close", "Volume"]
_MCP_PROTOCOL_VERSION = "2024-11-05"
_REQUEST_TIMEOUT_SECONDS = 30


def _split_args(raw: str) -> list[str]:
    return [item.strip() for item in raw.split(",") if item.strip()]


def _read_json_line(process: subprocess.Popen, timeout: float) -> dict[str, Any]:
    result: dict[str, Any] = {}
    error: list[BaseException] = []

    def reader():
        try:
            while True:
                line = process.stdout.readline() if process.stdout else ""
                if not line:
                    raise RuntimeError("MCP server closed stdout before returning a response")
                payload = json.loads(line)
                if "id" in payload or "result" in payload or "error" in payload:
                    result.update(payload)
                    return
        except BaseException as exc:  # pragma: no cover - defensive thread boundary
            error.append(exc)

    thread = threading.Thread(target=reader, daemon=True)
    thread.start()
    thread.join(timeout)
    if thread.is_alive():
        raise TimeoutError(f"MCP server did not respond within {timeout:.0f}s")
    if error:
        raise error[0]
    return result


def _send(process: subprocess.Popen, payload: dict[str, Any]) -> None:
    if not process.stdin:
        raise RuntimeError("MCP server stdin is not available")
    process.stdin.write(json.dumps(payload, ensure_ascii=False) + "\n")
    process.stdin.flush()


def _call_mcp_tool(command: str, args: list[str], tool_name: str, tool_args: dict[str, Any]) -> Any:
    process = subprocess.Popen(
        [command, *args],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
    )
    try:
        _send(process, {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": _MCP_PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": {"name": "choose-tradingagents", "version": "0.1"},
            },
        })
        init_response = _read_json_line(process, _REQUEST_TIMEOUT_SECONDS)
        if init_response.get("error"):
            raise RuntimeError(f"MCP initialize failed: {init_response['error']}")

        _send(process, {"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}})
        _send(process, {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {"name": tool_name, "arguments": tool_args},
        })
        response = _read_json_line(process, _REQUEST_TIMEOUT_SECONDS)
        if response.get("error"):
            raise RuntimeError(f"MCP tool call failed: {response['error']}")
        return response.get("result")
    finally:
        try:
            process.terminate()
            process.wait(timeout=3)
        except Exception:
            process.kill()


def _extract_payload(result: Any) -> Any:
    if isinstance(result, dict):
        if result.get("structuredContent") is not None:
            return result["structuredContent"]
        content = result.get("content")
        if isinstance(content, list):
            text_parts = [
                item.get("text")
                for item in content
                if isinstance(item, dict) and item.get("type") == "text" and item.get("text")
            ]
            if text_parts:
                text = "\n".join(text_parts)
                try:
                    return json.loads(text)
                except Exception:
                    return text
        return result
    return result


def _find_rows(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [row for row in payload if isinstance(row, dict)]
    if not isinstance(payload, dict):
        return []
    for key in ("data", "prices", "records", "items", "rows", "result"):
        value = payload.get(key)
        rows = _find_rows(value)
        if rows:
            return rows
    return []


def _value(row: dict[str, Any], *names: str) -> Any:
    normalized = {
        str(key).strip().lower().replace("_", "").replace(" ", ""): value
        for key, value in row.items()
    }
    for name in names:
        key = name.strip().lower().replace("_", "").replace(" ", "")
        if key in normalized:
            return normalized[key]
    return None


def _rows_to_ohlcv(rows: list[dict[str, Any]]) -> pd.DataFrame:
    if not rows:
        return pd.DataFrame(columns=_EMPTY_OHLCV_COLUMNS)
    data = pd.DataFrame([{
        "Date": _value(row, "date", "datetime", "time", "trade_date", "tradeDate", "day"),
        "Open": _value(row, "open", "open_price", "开盘"),
        "High": _value(row, "high", "high_price", "最高"),
        "Low": _value(row, "low", "low_price", "最低"),
        "Close": _value(row, "close", "close_price", "收盘"),
        "Adj Close": _value(row, "adj_close", "close", "close_price", "收盘"),
        "Volume": _value(row, "volume", "vol", "成交量"),
    } for row in rows])
    data["Date"] = pd.to_datetime(data["Date"], errors="coerce")
    for column in ["Open", "High", "Low", "Close", "Adj Close", "Volume"]:
        data[column] = pd.to_numeric(data[column], errors="coerce")
    data = data.dropna(subset=["Date", "Close"]).sort_values("Date")
    return data[_EMPTY_OHLCV_COLUMNS].reset_index(drop=True)


def _a_share_mcp_code(code: str) -> str:
    if code.startswith("6"):
        return f"sh{code}"
    if code.startswith(("0", "2", "3")):
        return f"sz{code}"
    if code.startswith(("4", "8")):
        return f"bj{code}"
    return code


def _calendar_count(start_date: str, end_date: str) -> int:
    try:
        start = datetime.strptime(start_date, "%Y-%m-%d")
        end = datetime.strptime(end_date, "%Y-%m-%d")
        return max(10, (end - start).days + 10)
    except Exception:
        return 60


def get_mcp_ohlcv(provider: str, code: str, start_date: str, end_date: str) -> pd.DataFrame:
    prefix = f"TRADINGAGENTS_{provider.upper()}_MCP"
    command = os.getenv(f"{prefix}_COMMAND")
    if not command:
        return pd.DataFrame(columns=_EMPTY_OHLCV_COLUMNS)
    args = _split_args(os.getenv(f"{prefix}_ARGS", ""))
    tool = os.getenv(f"{prefix}_TOOL", "get_price")
    result = _call_mcp_tool(command, args, tool, {
        "code": _a_share_mcp_code(code),
        "end_date": end_date,
        "count": _calendar_count(start_date, end_date),
        "frequency": "1d",
    })
    rows = _find_rows(_extract_payload(result))
    data = _rows_to_ohlcv(rows)
    if data.empty:
        return data
    cutoff_start = pd.to_datetime(start_date)
    cutoff_end = pd.to_datetime(end_date)
    data = data[(data["Date"] >= cutoff_start) & (data["Date"] <= cutoff_end)]
    data.attrs["source"] = provider.lower()
    return data.reset_index(drop=True)
