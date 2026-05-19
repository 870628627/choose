import os
import sys
import unittest
from unittest.mock import MagicMock, patch

import pandas as pd

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from tradingagents.dataflows import y_finance
from tradingagents.dataflows.a_share_data import yahoo_a_share_symbol


class YFinanceDataflowTests(unittest.TestCase):
    def setUp(self):
        y_finance._TICKER_CACHE.clear()
        y_finance._HISTORY_CACHE.clear()
        y_finance._INFO_CACHE.clear()
        y_finance._STATEMENT_CACHE.clear()

    def test_price_data_returns_markdown_with_source(self):
        history = pd.DataFrame(
            {
                "Open": [100.0],
                "High": [110.0],
                "Low": [99.0],
                "Close": [108.0],
                "Volume": [123456],
            },
            index=pd.to_datetime(["2026-05-18"]),
        )
        history.index.name = "Date"
        ticker = MagicMock()
        ticker.history.return_value = history

        with patch.object(y_finance.yf, "Ticker", return_value=ticker):
            result = y_finance.get_YFin_data_online("AAPL", "2026-05-01", "2026-05-19")

        self.assertIn("Source: Yahoo Finance / yfinance", result)
        self.assertIn("| Date | Open | High | Low | Close | Volume |", result)
        self.assertIn("108.0", result)

    def test_fundamentals_marks_missing_fields(self):
        ticker = MagicMock()
        ticker.info = {
            "longName": "NVIDIA Corporation",
            "sector": "Technology",
            "marketCap": 1000000000,
        }

        with patch.object(y_finance.yf, "Ticker", return_value=ticker):
            result = y_finance.get_fundamentals("NVDA", "2026-05-19")

        self.assertIn("Fundamentals: NVDA", result)
        self.assertIn("Yahoo Finance / yfinance", result)
        self.assertIn("Yahoo Finance 未返回该字段", result)

    def test_a_share_symbol_maps_to_yahoo_suffix(self):
        self.assertEqual(yahoo_a_share_symbol("688213"), "688213.SS")
        self.assertEqual(yahoo_a_share_symbol("000001"), "000001.SZ")


if __name__ == "__main__":
    unittest.main()
