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
    },
    "600036": {"name": "招商银行", "industry": "银行", "company_profile": "全国性股份制商业银行。"},
    "601318": {"name": "中国平安", "industry": "保险", "company_profile": "综合金融服务集团，覆盖保险、银行、资产管理等业务。"},
    "000858": {"name": "五粮液", "industry": "白酒", "company_profile": "主营浓香型白酒生产与销售。"},
    "002594": {"name": "比亚迪", "industry": "汽车", "company_profile": "主营新能源汽车、动力电池及相关电子业务。"},
    "000333": {"name": "美的集团", "industry": "家电", "company_profile": "主营智能家电、楼宇科技、机器人与自动化等业务。"},
    "600276": {"name": "恒瑞医药", "industry": "化学制药", "company_profile": "主营创新药和仿制药研发、生产与销售。"},
    "601398": {"name": "工商银行", "industry": "银行", "company_profile": "大型商业银行，提供公司金融、个人金融和资金业务。"},
    "601288": {"name": "农业银行", "industry": "银行", "company_profile": "大型商业银行，服务城乡金融和综合银行业务。"},
    "601988": {"name": "中国银行", "industry": "银行", "company_profile": "大型商业银行，提供商业银行、投资银行和保险等服务。"},
    "601328": {"name": "交通银行", "industry": "银行", "company_profile": "大型商业银行，提供公司、零售和金融市场业务。"},
    "601166": {"name": "兴业银行", "industry": "银行", "company_profile": "全国性股份制商业银行。"},
    "600000": {"name": "浦发银行", "industry": "银行", "company_profile": "全国性股份制商业银行。"},
    "600030": {"name": "中信证券", "industry": "证券", "company_profile": "综合证券公司，提供投行、经纪、资管等业务。"},
    "600900": {"name": "长江电力", "industry": "电力", "company_profile": "主营大型水电运营与管理。"},
    "600887": {"name": "伊利股份", "industry": "乳制品", "company_profile": "主营乳制品生产与销售。"},
    "601899": {"name": "紫金矿业", "industry": "贵金属", "company_profile": "主营金、铜等矿产资源勘查、开采和冶炼。"},
    "600309": {"name": "万华化学", "industry": "化工", "company_profile": "主营聚氨酯、石化和精细化学品。"},
    "601012": {"name": "隆基绿能", "industry": "光伏设备", "company_profile": "主营单晶硅片、电池组件和光伏解决方案。"},
    "002475": {"name": "立讯精密", "industry": "消费电子", "company_profile": "主营连接器、精密组件和消费电子制造。"},
    "002415": {"name": "海康威视", "industry": "计算机设备", "company_profile": "主营视频物联、安防和智能物联网产品。"},
    "300059": {"name": "东方财富", "industry": "互联网金融", "company_profile": "主营互联网金融信息服务和证券业务。"},
    "300760": {"name": "迈瑞医疗", "industry": "医疗器械", "company_profile": "主营医疗器械研发、制造与销售。"},
    "000651": {"name": "格力电器", "industry": "家电", "company_profile": "主营空调和生活电器。"},
    "601668": {"name": "中国建筑", "industry": "建筑工程", "company_profile": "主营房建、基建、地产开发和投资运营。"},
    "600028": {"name": "中国石化", "industry": "石油石化", "company_profile": "主营石油天然气勘探开发、炼化和销售。"},
    "601857": {"name": "中国石油", "industry": "石油石化", "company_profile": "主营油气勘探开发、炼化销售和天然气业务。"},
    "601633": {"name": "长城汽车", "industry": "汽车", "company_profile": "主营整车及汽车零部件研发、生产和销售。"},
    "000002": {"name": "万科A", "industry": "房地产开发", "company_profile": "主营房地产开发和物业服务。"},
    "000725": {"name": "京东方A", "industry": "光学光电子", "company_profile": "主营显示器件、物联网创新和传感业务。"},
    "002352": {"name": "顺丰控股", "industry": "物流", "company_profile": "主营快递物流、供应链和国际业务。"},
    "600031": {"name": "三一重工", "industry": "工程机械", "company_profile": "主营工程机械研发、制造和销售。"},
    "603288": {"name": "海天味业", "industry": "调味发酵品", "company_profile": "主营酱油、蚝油、调味酱等调味品。"},
    "000063": {"name": "中兴通讯", "industry": "通信设备", "company_profile": "主营通信设备和解决方案。"},
    "002230": {"name": "科大讯飞", "industry": "软件开发", "company_profile": "主营智能语音、人工智能产品和行业解决方案。"},
    "300014": {"name": "亿纬锂能", "industry": "电池", "company_profile": "主营消费电池、动力电池和储能电池。"},
    "000568": {"name": "泸州老窖", "industry": "白酒", "company_profile": "主营白酒生产与销售。"},
    "688728": {"name": "格科微", "industry": "半导体", "company_profile": "主营 CMOS 图像传感器和显示驱动芯片等集成电路产品。"},
    "603501": {"name": "韦尔股份", "industry": "半导体", "company_profile": "主营半导体设计、图像传感器和模拟芯片等业务。"},
    "688213": {"name": "思特威", "industry": "半导体", "company_profile": "主营高性能 CMOS 图像传感器芯片研发、设计和销售。"},
    "688469": {"name": "芯联集成", "industry": "半导体", "company_profile": "主营特色工艺晶圆代工及相关半导体制造服务。"},
    "688649": {"name": "盛美上海", "industry": "半导体设备", "company_profile": "主营半导体专用设备研发、生产和销售。"},
    "688981": {"name": "中芯国际", "industry": "半导体", "company_profile": "主营集成电路晶圆代工及配套服务。"}
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


def allow_demo_data() -> bool:
    return os.environ.get("DATA_ALLOW_DEMO", "").lower() in {"1", "true", "yes"}


def market_suffix(code: str) -> str:
    market = detect_market(code)
    if market == "SH":
        return f"{code}.SH"
    if market == "SZ":
        return f"{code}.SZ"
    if market == "BJ":
        return f"{code}.BJ"
    return code


def tx_symbol(code: str) -> str:
    market = detect_market(code).lower()
    if market in {"sh", "sz"}:
        return f"{market}{code}"
    return code


def fetch_stock_basic(code: str) -> Dict[str, Any]:
    basic = fallback_basic(code)
    if code in KNOWN_STOCKS:
        return basic

    ak = try_akshare()
    if ak:
        try:
            df = ak.stock_individual_info_em(symbol=code)
            info = dict(zip(df["item"].astype(str), df["value"].astype(str)))
            return {
                "code": code,
                "market": detect_market(code),
                "name": info.get("股票简称") or info.get("证券简称") or info.get("名称") or basic["name"],
                "industry": info.get("行业") or info.get("所属行业") or basic["industry"],
                "company_profile": info.get("主营业务") or info.get("经营范围") or basic["company_profile"],
                "listing_date": info.get("上市时间") or info.get("上市日期") or basic["listing_date"]
            }
        except Exception:
            pass

        try:
            code_name = ak.stock_info_a_code_name()
            match = code_name[code_name["code"].astype(str).str.zfill(6) == code]
            if not match.empty:
                row = match.iloc[0]
                basic["name"] = str(row.get("name") or row.get("名称") or basic["name"])
        except Exception:
            pass

    return basic


def fetch_daily_metrics(code: str) -> List[Dict[str, Any]]:
    ak = try_akshare()
    if ak:
        try:
            value_df = ak.stock_value_em(symbol=code)
            rows = []
            for _, row in value_df.tail(20).iterrows():
                trade_date = str(row.get("数据日期", ""))[:10]
                if not trade_date:
                    continue
                rows.append({
                    "trade_date": trade_date,
                    "close_price": _to_float(row.get("当日收盘价")),
                    "pe": _to_float(row.get("PE(静)")),
                    "pe_ttm": _to_float(row.get("PE(TTM)")),
                    "pb": _to_float(row.get("市净率")),
                    "ps": _to_float(row.get("市销率")),
                    "dividend_yield": None,
                    "market_cap": _to_float(row.get("总市值")),
                    "turnover_rate": None,
                    "source": "akshare-eastmoney-value"
                })
            if rows:
                return rows
        except Exception:
            pass

        try:
            hist = ak.stock_zh_a_hist_tx(symbol=tx_symbol(code))
            rows = []
            for _, row in hist.tail(20).iterrows():
                trade_date = str(row.get("date", ""))[:10]
                if not trade_date:
                    continue
                rows.append({
                    "trade_date": trade_date,
                    "close_price": _to_float(row.get("close")),
                    "pe": None,
                    "pe_ttm": None,
                    "pb": None,
                    "ps": None,
                    "dividend_yield": None,
                    "market_cap": None,
                    "turnover_rate": None,
                    "source": "akshare-tencent"
                })
            if rows:
                return rows
        except Exception:
            pass

        try:
            end = date.today().strftime("%Y%m%d")
            start = (date.today() - timedelta(days=45)).strftime("%Y%m%d")
            hist = ak.stock_zh_a_hist(symbol=code, period="daily", start_date=start, end_date=end, adjust="")

            rows = []
            for _, row in hist.tail(20).iterrows():
                trade_date = str(row.get("日期", ""))[:10]
                rows.append({
                    "trade_date": trade_date,
                    "close_price": _to_float(row.get("收盘")),
                    "pe": None,
                    "pe_ttm": None,
                    "pb": None,
                    "ps": None,
                    "dividend_yield": None,
                    "market_cap": None,
                    "turnover_rate": _to_float(row.get("换手率")),
                    "source": "akshare"
                })
            if rows:
                return rows
        except Exception:
            pass

    if not allow_demo_data():
        return []

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
    ak = try_akshare()
    if ak:
        try:
            df = ak.stock_financial_analysis_indicator_em(symbol=market_suffix(code))
            rows = []
            for _, row in df.head(12).iterrows():
                report_period = str(row.get("REPORT_DATE", ""))[:10]
                if not report_period:
                    continue
                rows.append({
                    "report_period": report_period,
                    "revenue": _to_float(row.get("TOTALOPERATEREVE")),
                    "net_profit": _to_float(row.get("PARENTNETPROFIT")),
                    "revenue_growth": _to_float(row.get("TOTALOPERATEREVETZ")),
                    "net_profit_growth": _to_float(row.get("PARENTNETPROFITTZ")),
                    "gross_margin": _to_float(row.get("XSMLL")),
                    "net_margin": _to_float(row.get("XSJLL")),
                    "roe": _to_float(row.get("ROEJQ")),
                    "debt_asset_ratio": _to_float(row.get("ZCFZL")),
                    "operating_cash_flow": None,
                    "source": "akshare-eastmoney"
                })
            if rows:
                return rows
        except Exception:
            pass

    if not allow_demo_data():
        return []

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
    ak = try_akshare()
    if ak:
        try:
            df = ak.stock_individual_notice_report(security=code)
            rows = []
            for _, row in df.head(30).iterrows():
                rows.append({
                    "title": clean_text(row.get("公告标题")),
                    "published_at": str(row.get("公告日期") or "")[:10],
                    "announcement_type": clean_text(row.get("公告类型")),
                    "url": str(row.get("网址") or ""),
                    "source": "akshare-eastmoney"
                })
            rows = [item for item in rows if item["title"] and item["published_at"]]
            if rows:
                return rows
        except Exception:
            pass

    if not allow_demo_data():
        return []

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


def clean_text(value: Any) -> str:
    text = "" if value is None else str(value)
    if any(marker in text for marker in ["æ", "è", "å", "ã"]):
        for encoding in ("latin1", "cp1252"):
            try:
                return text.encode(encoding).decode("utf-8")
            except Exception:
                continue
    return text


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
