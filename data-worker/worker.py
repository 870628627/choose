import argparse
import hashlib
import json
import os
import random
import sys
from datetime import date, timedelta
from typing import Any, Dict, List


KNOWN_STOCKS: Dict[str, Dict[str, str]] = {
    "600519": {
        "name": "贵州茅台",
        "industry": "白酒",
        "company_profile": "主营贵州茅台酒及系列酒的生产与销售。"
    },
    "000001": {
        "name": "平安银行",
        "industry": "银行",
        "company_profile": "全国性股份制商业银行，提供公司、零售和金融市场业务。"
    },
    "300750": {
        "name": "宁德时代",
        "industry": "电池",
        "company_profile": "主营动力电池和储能电池系统研发、生产和销售。"
    }
}


def stable_random(code: str) -> random.Random:
    seed = int(hashlib.sha256(code.encode("utf-8")).hexdigest()[:12], 16)
    return random.Random(seed)


def detect_market(code: str) -> str:
    if code.startswith("6"):
        return "SH"
    if code.startswith(("0", "3")):
        return "SZ"
    if code.startswith(("4", "8")):
        return "BJ"
    return "UNKNOWN"


def fallback_basic(code: str) -> Dict[str, Any]:
    known = KNOWN_STOCKS.get(code)
    return {
        "code": code,
        "market": detect_market(code),
        "name": known["name"] if known else f"A股{code}",
        "industry": known["industry"] if known else "未识别行业",
        "company_profile": known["company_profile"] if known else "演示数据：公司基础资料待接入正式数据源后补充。",
        "listing_date": "2001-01-01"
    }


def try_akshare():
    try:
        import akshare as ak  # type: ignore

        return ak
    except Exception:
        return None


def fetch_stock_basic(code: str) -> Dict[str, Any]:
    ak = try_akshare()
    if ak:
        try:
            df = ak.stock_individual_info_em(symbol=code)
            info = dict(zip(df["item"].astype(str), df["value"].astype(str)))
            return {
                "code": code,
                "market": detect_market(code),
                "name": info.get("股票简称") or info.get("证券简称") or fallback_basic(code)["name"],
                "industry": info.get("行业") or fallback_basic(code)["industry"],
                "company_profile": info.get("主营业务") or fallback_basic(code)["company_profile"],
                "listing_date": info.get("上市时间") or fallback_basic(code)["listing_date"]
            }
        except Exception:
            pass
    return fallback_basic(code)


def fetch_daily_metrics(code: str) -> List[Dict[str, Any]]:
    ak = try_akshare()
    if ak:
        try:
            end = date.today().strftime("%Y%m%d")
            start = (date.today() - timedelta(days=45)).strftime("%Y%m%d")
            hist = ak.stock_zh_a_hist(symbol=code, period="daily", start_date=start, end_date=end, adjust="")
            rng = stable_random(f"{code}-valuation")
            fallback_pe = rng.uniform(8, 65)
            fallback_pb = rng.uniform(0.8, 9)

            rows = []
            for _, row in hist.tail(20).iterrows():
                trade_date = str(row.get("日期", ""))[:10]
                rows.append({
                    "trade_date": trade_date,
                    "close_price": _to_float(row.get("收盘")),
                    "pe": round(fallback_pe * rng.uniform(0.96, 1.04), 2),
                    "pe_ttm": round(fallback_pe * rng.uniform(0.96, 1.04), 2),
                    "pb": round(fallback_pb * rng.uniform(0.96, 1.04), 2),
                    "ps": round(rng.uniform(1, 12), 2),
                    "dividend_yield": round(rng.uniform(0, 4.5), 2),
                    "market_cap": None,
                    "turnover_rate": _to_float(row.get("换手率")),
                    "source": "akshare+demo-valuation"
                })
            if rows:
                return rows
        except Exception:
            pass

    rng = stable_random(code)
    today = date.today()
    base_price = rng.uniform(8, 240)
    pe_ttm = rng.uniform(8, 65)
    pb = rng.uniform(0.8, 9)
    rows = []
    for offset in range(19, -1, -1):
        d = today - timedelta(days=offset)
        drift = rng.uniform(-0.035, 0.035)
        base_price = max(1, base_price * (1 + drift))
        rows.append({
            "trade_date": d.isoformat(),
            "close_price": round(base_price, 2),
            "pe": round(pe_ttm * rng.uniform(0.96, 1.04), 2),
            "pe_ttm": round(pe_ttm * rng.uniform(0.96, 1.04), 2),
            "pb": round(pb * rng.uniform(0.96, 1.04), 2),
            "ps": round(rng.uniform(1, 12), 2),
            "dividend_yield": round(rng.uniform(0, 4.5), 2),
            "market_cap": round(rng.uniform(80, 25000), 2),
            "turnover_rate": round(rng.uniform(0.2, 7), 2),
            "source": "demo"
        })
    return rows


def fetch_financials(code: str) -> List[Dict[str, Any]]:
    rng = stable_random(f"{code}-financial")
    periods = ["2023-12-31", "2024-06-30", "2024-12-31", "2025-06-30", "2025-12-31"]
    revenue = rng.uniform(80, 2500)
    rows = []
    for period in periods:
        revenue_growth = rng.uniform(-12, 35)
        net_profit_growth = rng.uniform(-20, 45)
        revenue = revenue * (1 + revenue_growth / 100)
        net_margin = rng.uniform(5, 35)
        net_profit = revenue * net_margin / 100
        rows.append({
            "report_period": period,
            "revenue": round(revenue, 2),
            "net_profit": round(net_profit, 2),
            "revenue_growth": round(revenue_growth, 2),
            "net_profit_growth": round(net_profit_growth, 2),
            "gross_margin": round(rng.uniform(18, 68), 2),
            "net_margin": round(net_margin, 2),
            "roe": round(rng.uniform(4, 32), 2),
            "debt_asset_ratio": round(rng.uniform(18, 78), 2),
            "operating_cash_flow": round(rng.uniform(-60, 600), 2),
            "source": "demo"
        })
    return rows


def fetch_announcements(code: str) -> List[Dict[str, Any]]:
    basic = fallback_basic(code)
    today = date.today()
    templates = [
        ("年度报告摘要", "定期报告"),
        ("关于召开年度股东大会的通知", "股东大会"),
        ("关于经营情况阶段性说明的公告", "经营公告"),
        ("关于控股股东减持计划期限届满的公告", "权益变动"),
        ("关于收到监管问询函并回复的公告", "监管问询")
    ]
    rows = []
    for index, (title, kind) in enumerate(templates):
        rows.append({
            "title": f"{basic['name']}：{title}",
            "published_at": (today - timedelta(days=index * 17 + 2)).isoformat(),
            "announcement_type": kind,
            "url": f"https://www.cninfo.com.cn/new/disclosure/stock?stockCode={code}",
            "source": "demo-cninfo"
        })
    return rows


def sync_one(code: str) -> Dict[str, Any]:
    return {
        "basic": fetch_stock_basic(code),
        "daily_metrics": fetch_daily_metrics(code),
        "financial_metrics": fetch_financials(code),
        "announcements": fetch_announcements(code)
    }


def _to_float(value: Any):
    try:
        if value is None or value == "":
            return None
        return float(value)
    except Exception:
        return None


def emit(payload: Any):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description="A-share family research data-worker")
    parser.add_argument("task", choices=[
        "fetch_stock_basic",
        "fetch_daily_metrics",
        "fetch_financials",
        "fetch_announcements",
        "sync_all"
    ])
    parser.add_argument("--code")
    parser.add_argument("--codes")
    args = parser.parse_args()

    os.environ.setdefault("PYTHONUTF8", "1")

    if args.task != "sync_all" and not args.code:
        raise SystemExit("--code is required for this task")

    if args.task == "fetch_stock_basic":
        emit(fetch_stock_basic(args.code))
    elif args.task == "fetch_daily_metrics":
        emit(fetch_daily_metrics(args.code))
    elif args.task == "fetch_financials":
        emit(fetch_financials(args.code))
    elif args.task == "fetch_announcements":
        emit(fetch_announcements(args.code))
    elif args.task == "sync_all":
        codes = [code.strip() for code in (args.codes or "").split(",") if code.strip()]
        emit({"stocks": [sync_one(code) for code in codes]})


if __name__ == "__main__":
    main()
