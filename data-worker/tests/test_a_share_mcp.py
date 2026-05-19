import os
import sys
import unittest

import pandas as pd

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from tradingagents.dataflows import a_share_mcp
from tradingagents.dataflows.a_share_data import _configured_sources


class AShareMcpTests(unittest.TestCase):
    def test_parse_structured_mcp_payload_to_ohlcv(self):
        payload = {
            "data": [
                {
                    "date": "2026-05-18",
                    "open": 10.1,
                    "high": 10.8,
                    "low": 9.9,
                    "close": 10.5,
                    "volume": 123400,
                }
            ]
        }
        rows = a_share_mcp._find_rows(payload)
        data = a_share_mcp._rows_to_ohlcv(rows)

        self.assertIsInstance(data, pd.DataFrame)
        self.assertEqual(list(data.columns), ["Date", "Open", "High", "Low", "Close", "Adj Close", "Volume"])
        self.assertEqual(float(data.iloc[0]["Close"]), 10.5)

    def test_default_a_share_sources_start_with_mcp_then_tushare(self):
        self.assertEqual(
            _configured_sources()[:3],
            ["sina_mcp", "zhiyan_mcp", "tushare"],
        )


if __name__ == "__main__":
    unittest.main()
