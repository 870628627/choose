"""Pydantic schemas used by agents that produce structured output.

The framework's primary artifact is still prose: each agent's natural-language
reasoning is what users read in the saved markdown reports and what the
downstream agents read as context.  Structured output is layered onto the
three decision-making agents (Research Manager, Trader, Portfolio Manager)
so that:

- Their outputs follow consistent section headers across runs and providers
- Each provider's native structured-output mode is used (json_schema for
  OpenAI/xAI, response_schema for Gemini, tool-use for Anthropic)
- Schema field descriptions become the model's output instructions, freeing
  the prompt body to focus on context and the rating-scale guidance
- A render helper turns the parsed Pydantic instance back into the same
  markdown shape the rest of the system already consumes, so display,
  memory log, and saved reports keep working unchanged
"""

from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Shared rating types
# ---------------------------------------------------------------------------


class PortfolioRating(str, Enum):
    """5-tier rating used by the Research Manager and Portfolio Manager."""

    BUY = "Buy"
    OVERWEIGHT = "Overweight"
    HOLD = "Hold"
    UNDERWEIGHT = "Underweight"
    SELL = "Sell"


class TraderAction(str, Enum):
    """3-tier transaction direction used by the Trader.

    The Trader's job is to translate the Research Manager's investment plan
    into a concrete transaction proposal: should the desk execute a Buy, a
    Sell, or sit on Hold this round.  Position sizing and the nuanced
    Overweight / Underweight calls happen later at the Portfolio Manager.
    """

    BUY = "Buy"
    HOLD = "Hold"
    SELL = "Sell"


# ---------------------------------------------------------------------------
# Research Manager
# ---------------------------------------------------------------------------


class ResearchPlan(BaseModel):
    """Structured investment plan produced by the Research Manager.

    Hand-off to the Trader: the recommendation pins the directional view,
    the rationale captures which side of the bull/bear debate carried the
    argument, and the strategic actions translate that into concrete
    instructions the trader can execute against.
    """

    recommendation: PortfolioRating = Field(
        description=(
            "The investment recommendation. Exactly one of Buy / Overweight / "
            "Hold / Underweight / Sell. Reserve Hold for situations where the "
            "evidence on both sides is genuinely balanced; otherwise commit to "
            "the side with the stronger arguments."
        ),
    )
    rationale: str = Field(
        description=(
            "Conversational summary of the key points from both sides of the "
            "debate, ending with which arguments led to the recommendation. "
            "Speak naturally, as if to a teammate."
        ),
    )
    strategic_actions: str = Field(
        description=(
            "Concrete steps for the trader to implement the recommendation, "
            "including position sizing guidance consistent with the rating."
        ),
    )


def render_research_plan(plan: ResearchPlan) -> str:
    """Render a ResearchPlan to markdown for storage and the trader's prompt context."""
    return "\n".join([
        f"**Recommendation**: {plan.recommendation.value}",
        "",
        f"**Rationale**: {plan.rationale}",
        "",
        f"**Strategic Actions**: {plan.strategic_actions}",
    ])


# ---------------------------------------------------------------------------
# Trader
# ---------------------------------------------------------------------------


class TraderProposal(BaseModel):
    """Structured transaction proposal produced by the Trader.

    The trader reads the Research Manager's investment plan and the analyst
    reports, then turns them into a concrete transaction: what action to
    take, the reasoning that justifies it, and the practical levels for
    entry, stop-loss, and sizing.
    """

    action: TraderAction = Field(
        description="The transaction direction. Exactly one of Buy / Hold / Sell.",
    )
    reasoning: str = Field(
        description=(
            "The case for this action, anchored in the analysts' reports and "
            "the research plan. Two to four sentences."
        ),
    )
    entry_price: Optional[float] = Field(
        default=None,
        description="Optional entry price target in the instrument's quote currency.",
    )
    stop_loss: Optional[float] = Field(
        default=None,
        description="Optional stop-loss price in the instrument's quote currency.",
    )
    position_sizing: Optional[str] = Field(
        default=None,
        description="Optional sizing guidance, e.g. '5% of portfolio'.",
    )


def render_trader_proposal(proposal: TraderProposal) -> str:
    """Render a TraderProposal to markdown.

    The trailing ``FINAL TRANSACTION PROPOSAL: **BUY/HOLD/SELL**`` line is
    preserved for backward compatibility with the analyst stop-signal text
    and any external code that greps for it.
    """
    parts = [
        f"**Action**: {proposal.action.value}",
        "",
        f"**Reasoning**: {proposal.reasoning}",
    ]
    if proposal.entry_price is not None:
        parts.extend(["", f"**Entry Price**: {proposal.entry_price}"])
    if proposal.stop_loss is not None:
        parts.extend(["", f"**Stop Loss**: {proposal.stop_loss}"])
    if proposal.position_sizing:
        parts.extend(["", f"**Position Sizing**: {proposal.position_sizing}"])
    parts.extend([
        "",
        f"FINAL TRANSACTION PROPOSAL: **{proposal.action.value.upper()}**",
    ])
    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Portfolio Manager
# ---------------------------------------------------------------------------


class PortfolioDecision(BaseModel):
    """Structured output produced by the Portfolio Manager.

    The model fills every field as part of its primary LLM call; no separate
    extraction pass is required. Field descriptions double as the model's
    output instructions, so the prompt body only needs to convey context and
    the rating-scale guidance.
    """

    rating: PortfolioRating = Field(
        description=(
            "The final position rating. Exactly one of Buy / Overweight / Hold / "
            "Underweight / Sell, picked based on the analysts' debate."
        ),
    )
    action_instruction: str = Field(
        description=(
            "A concise Chinese final action instruction, e.g. 买入、分批加仓、持有观望、"
            "减仓、卖出/清仓. It must be consistent with the rating."
        ),
    )
    executive_summary: str = Field(
        description=(
            "A concise action plan covering entry strategy, position sizing, "
            "key risk levels, and time horizon. Two to four sentences."
        ),
    )
    execution_plan: str = Field(
        description=(
            "Concrete Chinese execution plan. Include what to do now, what to do "
            "on pullback/breakout, and how to handle existing vs new positions."
        ),
    )
    investment_thesis: str = Field(
        description=(
            "Detailed reasoning anchored in specific evidence from the analysts' "
            "debate. If prior lessons are referenced in the prompt context, "
            "incorporate them; otherwise rely solely on the current analysis."
        ),
    )
    risk_controls: str = Field(
        description=(
            "Chinese risk-control rules: stop-loss, invalidation conditions, "
            "position reduction triggers, and the main downside risks."
        ),
    )
    position_sizing: Optional[str] = Field(
        default=None,
        description="Optional Chinese position sizing guidance, e.g. '控制在标配仓位的50%以内'.",
    )
    reference_price: Optional[float] = Field(
        default=None,
        description="Optional current/reference price in the instrument's quote currency.",
    )
    price_target: Optional[float] = Field(
        default=None,
        description="Optional target price in the instrument's quote currency.",
    )
    stop_loss: Optional[float] = Field(
        default=None,
        description="Optional stop-loss or invalidation price in the instrument's quote currency.",
    )
    time_horizon: Optional[str] = Field(
        default=None,
        description="Optional recommended holding period, e.g. '3-6 months'.",
    )
    watch_items: Optional[str] = Field(
        default=None,
        description="Optional Chinese follow-up signals to monitor after the decision.",
    )


_RATING_CN = {
    "Buy": "买入",
    "Overweight": "增配",
    "Hold": "持有",
    "Underweight": "减配",
    "Sell": "卖出",
}

_DEFAULT_ACTION = {
    "Buy": "买入或分批建仓",
    "Overweight": "增配，逢低逐步加仓",
    "Hold": "持有观望，不主动加仓",
    "Underweight": "减仓，降低风险敞口",
    "Sell": "卖出或空仓回避",
}


def _cell(value: object) -> str:
    text = "未明确" if value is None or value == "" else str(value)
    return text.replace("|", " / ").replace("\r", " ").replace("\n", "；")


def _price(value: Optional[float]) -> str:
    if value is None:
        return "未明确"
    return f"{value:g}"


def _rating_text(rating: PortfolioRating | str) -> str:
    return rating.value if isinstance(rating, PortfolioRating) else str(rating)


def _render_standard_pm_markdown(
    *,
    rating: PortfolioRating | str,
    action_instruction: Optional[str],
    executive_summary: str,
    execution_plan: str,
    investment_thesis: str,
    risk_controls: str,
    position_sizing: Optional[str] = None,
    reference_price: Optional[float] = None,
    price_target: Optional[float] = None,
    stop_loss: Optional[float] = None,
    time_horizon: Optional[str] = None,
    watch_items: Optional[str] = None,
) -> str:
    rating_value = _rating_text(rating)
    rating_cn = _RATING_CN.get(rating_value, "未明确")
    action = action_instruction or _DEFAULT_ACTION.get(rating_value, "按报告规则执行")

    return "\n".join([
        "# 最终交易决策",
        "",
        "## 一、交易指令总览",
        "",
        "| 项目 | 结论 |",
        "|---|---|",
        f"| 最终动作 | {_cell(action)} |",
        f"| 系统评级 | {_cell(f'{rating_value}（{rating_cn}）')} |",
        f"| 参考价格 | {_cell(_price(reference_price))} |",
        f"| 目标价 | {_cell(_price(price_target))} |",
        f"| 止损/失效位 | {_cell(_price(stop_loss))} |",
        f"| 仓位建议 | {_cell(position_sizing)} |",
        f"| 时间周期 | {_cell(time_horizon)} |",
        "",
        "## 二、执行摘要",
        "",
        executive_summary.strip() or "未明确。",
        "",
        "## 三、执行计划",
        "",
        execution_plan.strip() or "未明确。",
        "",
        "## 四、核心依据",
        "",
        investment_thesis.strip() or "未明确。",
        "",
        "## 五、风险控制与失效条件",
        "",
        risk_controls.strip() or "未明确。",
        "",
        "## 六、后续观察信号",
        "",
        (watch_items or "观察价格是否触发执行计划中的关键价位，以及基本面、情绪面和成交量是否验证当前判断。").strip(),
    ])


def render_pm_decision(decision: PortfolioDecision) -> str:
    """Render a PortfolioDecision to the canonical Chinese final-decision template."""
    return _render_standard_pm_markdown(
        rating=decision.rating,
        action_instruction=decision.action_instruction,
        executive_summary=decision.executive_summary,
        execution_plan=decision.execution_plan,
        investment_thesis=decision.investment_thesis,
        risk_controls=decision.risk_controls,
        position_sizing=decision.position_sizing,
        reference_price=decision.reference_price,
        price_target=decision.price_target,
        stop_loss=decision.stop_loss,
        time_horizon=decision.time_horizon,
        watch_items=decision.watch_items,
    )


def normalize_pm_decision_markdown(text: str) -> str:
    """Wrap free-text Portfolio Manager output in the same Chinese template.

    Structured output should already be rendered by ``render_pm_decision``.
    This fallback keeps provider failures from leaking inconsistent prose
    shapes into saved reports.
    """
    if "# 最终交易决策" in text and "## 一、交易指令总览" in text:
        return text

    from tradingagents.agents.utils.rating import parse_rating

    rating = parse_rating(text)
    return _render_standard_pm_markdown(
        rating=rating,
        action_instruction=_DEFAULT_ACTION.get(rating),
        executive_summary="模型未返回完整结构化字段，以下为原始组合经理结论的标准化封装。",
        execution_plan="请先阅读下方原始决策依据，再结合仓位、流动性和风险承受能力执行。",
        investment_thesis=text.strip() or "未返回有效决策内容。",
        risk_controls="原始输出未明确完整风控字段。执行前请自行确认止损位、仓位上限、财报/公告风险和市场流动性。",
        watch_items="若后续价格、成交量、公告或基本面数据与原始判断相反，应重新生成报告或人工复核。",
    )
