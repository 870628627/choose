"""Shared 5-tier rating vocabulary and a deterministic heuristic parser.

The same five-tier scale (Buy, Overweight, Hold, Underweight, Sell) is used by:
- The Research Manager (investment plan recommendation)
- The Portfolio Manager (final position decision)
- The signal processor (rating extracted for downstream consumers)
- The memory log (rating tag stored alongside each decision entry)

Centralising it here avoids drift between those call sites.
"""

from __future__ import annotations

import re
from typing import Tuple


# Canonical, ordered 5-tier scale (most bullish to most bearish).
RATINGS_5_TIER: Tuple[str, ...] = (
    "Buy", "Overweight", "Hold", "Underweight", "Sell",
)

_RATING_SET = {r.lower() for r in RATINGS_5_TIER}

# Matches "Rating: X", "系统评级：X", or "最终评级：X" — tolerates
# markdown bold wrappers, Chinese punctuation, and parenthetical Chinese labels.
_RATING_LABEL_RE = re.compile(
    r"(?:rating|系统评级|最终评级|评级)[^A-Za-z]*"
    r"(buy|overweight|hold|underweight|sell)(?:\b|[^A-Za-z])",
    re.IGNORECASE,
)

_CHINESE_LABEL_RE = re.compile(
    r"(?:最终动作|最终建议|交易建议|我的决策|最终评级|系统评级|评级).*?"
    r"(清仓|卖出|强烈买入|买入|增配|加仓|减仓|减配|低配|持有|观望)"
)

_CHINESE_RATING_HINTS = (
    ("清仓", "Sell"),
    ("卖出", "Sell"),
    ("减仓", "Underweight"),
    ("减配", "Underweight"),
    ("低配", "Underweight"),
    ("强烈买入", "Buy"),
    ("买入", "Buy"),
    ("不主动加仓", "Hold"),
    ("持有观望", "Hold"),
    ("持有", "Hold"),
    ("观望", "Hold"),
    ("加仓", "Overweight"),
    ("增配", "Overweight"),
)


def parse_rating(text: str, default: str = "Hold") -> str:
    """Heuristically extract a 5-tier rating from prose text.

    Two-pass strategy:
    1. Look for an explicit "Rating: X" label (tolerant of markdown bold).
    2. Fall back to the first 5-tier rating word found anywhere in the text.

    Returns a Title-cased rating string, or ``default`` if no rating word appears.
    """
    for line in text.splitlines():
        m = _RATING_LABEL_RE.search(line)
        if m:
            value = m.group(1).lower()
            if value in _RATING_SET:
                return value.capitalize()

        chinese = _CHINESE_LABEL_RE.search(line)
        if chinese:
            label = chinese.group(1)
            for hint, rating in _CHINESE_RATING_HINTS:
                if hint == label:
                    return rating

    for line in text.splitlines():
        for word in line.lower().split():
            clean = word.strip("*:.,:：;；()（）[]【】")
            if clean in _RATING_SET:
                return clean.capitalize()

    for hint, rating in _CHINESE_RATING_HINTS:
        if hint in text:
            return rating

    return default
