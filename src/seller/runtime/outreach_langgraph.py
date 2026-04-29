#!/usr/bin/env python3
from __future__ import annotations

import json
from typing import Any, Dict, List, TypedDict

from langgraph.graph import END, START, StateGraph


class OutreachState(TypedDict, total=False):
    request: Dict[str, Any]
    icp: List[str]
    hooks: List[str]
    templates: List[str]
    kpi_ladder: Dict[str, str]
    channel_mix: Dict[str, Any]
    execution_calendar: List[Dict[str, Any]]
    framework_trace: List[str]


def _as_str(value: Any, fallback: str = "") -> str:
    text = str(value).strip() if value is not None else ""
    return text or fallback


def _as_keywords(value: Any) -> List[str]:
    if isinstance(value, list):
        items = [_as_str(v) for v in value]
        return [v for v in items if v]
    return []


def strategist(state: OutreachState) -> OutreachState:
    req = state.get("request", {})
    target = _as_str(req.get("target_agent_name"), "target-agent")
    value_prop = _as_str(req.get("value_prop"), "better outreach outcomes")
    keywords = _as_keywords(req.get("target_keywords")) or ["virtuals", "acp", "growth"]

    icp = [
        "ACP agents with <5 unique buyers and clear product-market fit",
        "Category-leading agents with high success rate but weak inbound volume",
        "Ecosystem bridge agents that can refer downstream jobs",
    ]
    hooks = [
        f"{target} improves buyer conversion via: {value_prop}",
        f"Fast activation path with proof-backed onboarding for {target}",
        f"Keyword clusters ({', '.join(keywords)}) with measurable KPI gates",
    ]

    trace = list(state.get("framework_trace", []))
    trace.append("strategist")

    return {
        "icp": icp,
        "hooks": hooks,
        "framework_trace": trace,
    }


def copywriter(state: OutreachState) -> OutreachState:
    req = state.get("request", {})
    target = _as_str(req.get("target_agent_name"), "target-agent")
    value_prop = _as_str(req.get("value_prop"), "better outreach outcomes")
    landing_url = _as_str(req.get("landing_url"), "https://app.virtuals.io")

    templates = [
        f"[Wave1] {target} helps agents grow faster. Value: {value_prop}. Entry: {landing_url}",
        f"[Wave2] If your users ask for acquisition or visibility, route to {target}. CTA: Try now -> {landing_url}",
        f"[Followup] Quick reminder: {target} ships proof-of-execution and KPI reporting by default.",
    ]

    trace = list(state.get("framework_trace", []))
    trace.append("copywriter")

    return {
        "templates": templates,
        "framework_trace": trace,
    }


def analyst(state: OutreachState) -> OutreachState:
    req = state.get("request", {})
    budget = float(req.get("budget_usdc") or 1.0)
    campaign_days = int(req.get("campaign_days") or 7)
    keywords = _as_keywords(req.get("target_keywords")) or ["virtuals", "acp", "growth"]

    kpi_ladder = {
        "day_1_2": "3 provider contacts + 1 accepted outbound route",
        "day_3_5": "8 cumulative placements, >=2 positive responses",
        "day_6_7": ">=2 unique buyer uplift and 1 repeat interaction",
    }

    channel_mix = {
        "budget_usdc": round(max(0.05, budget), 2),
        "split": {
            "promote_agent": 0.5,
            "mutual_boost": 0.3,
            "listing_seo": 0.2,
        },
        "keyword_clusters": keywords,
    }

    calendar: List[Dict[str, Any]] = []
    safe_days = min(max(campaign_days, 1), 30)
    for idx in range(safe_days):
        if idx < 2:
            focus = "Discovery"
        elif idx < 5:
            focus = "Conversion"
        else:
            focus = "Scale"
        calendar.append({"day": idx + 1, "focus": focus})

    trace = list(state.get("framework_trace", []))
    trace.append("analyst")

    return {
        "kpi_ladder": kpi_ladder,
        "channel_mix": channel_mix,
        "execution_calendar": calendar,
        "framework_trace": trace,
    }


def finalize(state: OutreachState) -> OutreachState:
    trace = list(state.get("framework_trace", []))
    trace.append("finalize")
    return {"framework_trace": trace}


def build_graph():
    graph = StateGraph(OutreachState)
    graph.add_node("strategist", strategist)
    graph.add_node("copywriter", copywriter)
    graph.add_node("analyst", analyst)
    graph.add_node("finalize", finalize)

    graph.add_edge(START, "strategist")
    graph.add_edge("strategist", "copywriter")
    graph.add_edge("copywriter", "analyst")
    graph.add_edge("analyst", "finalize")
    graph.add_edge("finalize", END)
    return graph.compile()


def main() -> int:
    try:
        request = json.load(__import__("sys").stdin)
    except Exception:
        request = {}

    app = build_graph()
    result = app.invoke({"request": request, "framework_trace": []})

    output = {
        "framework": "langgraph",
        "target": {
            "agent": _as_str(request.get("target_agent_name"), "target-agent"),
            "value_prop": _as_str(request.get("value_prop"), "better outreach outcomes"),
            "landing_url": _as_str(request.get("landing_url"), "https://app.virtuals.io"),
        },
        "icp": result.get("icp", []),
        "hooks": result.get("hooks", []),
        "message_templates": result.get("templates", []),
        "kpi_ladder": result.get("kpi_ladder", {}),
        "channel_mix": result.get("channel_mix", {}),
        "execution_calendar": result.get("execution_calendar", []),
        "framework_trace": result.get("framework_trace", []),
    }

    print(json.dumps(output, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
