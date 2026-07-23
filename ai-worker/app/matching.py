"""资源内容规范化 + 规则理由（镜像 Next.js 侧 src/lib/ai，保证两侧语义一致）。

隐私红线：build_resource_text 刻意不含 contactInfo / contactVisibility / realName / 任何 id。
"""
import re
from typing import Any


def _val(r: dict, k: str) -> str:
    v = r.get(k)
    if v is None:
        return ""
    if isinstance(v, list):
        return "/".join(str(x) for x in v if x is not None)
    return str(v)


def build_resource_text(target_type: str, r: dict) -> str:
    if target_type == "ITEM":
        return "\n".join([
            "类型=物品",
            f"标题={_val(r, 'title')}",
            f"分类={_val(r, 'category')}",
            f"成色={_val(r, 'condition')}",
            f"描述={_val(r, 'description')}",
            f"标签={_val(r, 'tags')}",
            f"价格={_val(r, 'priceMode')}:{_val(r, 'price')}",
            f"交易方式={_val(r, 'tradeMethods')}",
            f"地点={_val(r, 'pickupLocation')}",
        ])
    if target_type == "SERVICE":
        return "\n".join([
            "类型=服务",
            f"标题={_val(r, 'title')}",
            f"分类={_val(r, 'categories')}",
            f"形式={_val(r, 'formats')}",
            f"时长={_val(r, 'durationTier')}",
            f"价格={_val(r, 'price')}",
            f"资质={_val(r, 'qualification')}",
            f"描述={_val(r, 'description')}",
        ])
    return "\n".join([
        "类型=需求",
        f"标题={_val(r, 'title')}",
        f"分类={_val(r, 'category')}",
        f"报酬={_val(r, 'reward')}",
        f"期望时间={_val(r, 'expectedTime')}",
        f"形式偏好={_val(r, 'formatPreference')}",
        f"期望画像={_val(r, 'expectedProfile')}",
        f"描述={_val(r, 'description')}",
    ])


def parse_price_number(s: Any) -> int | None:
    if not isinstance(s, str):
        return None
    m = re.search(r"(\d{2,7})", s)
    return int(m.group(1)) if m else None


def build_reasons(
    source: dict,
    target: dict,
    source_type: str,
    target_type: str,
    score: float,
) -> list[str]:
    """规则模板（FEATURE_DEV §8.3）：只基于 DB 字段，最多 3 条，不编造。"""
    reasons: list[str] = []
    if score >= 0.45:
        reasons.append("内容语义高度相关")

    if source_type == "NEED" and target_type == "ITEM":
        budget = parse_price_number(source.get("reward"))
        item_price = target.get("price")
        item_mode = target.get("priceMode")
        if item_mode == "FREE":
            reasons.append("对方免费赠送，符合预算")
        elif budget is not None and isinstance(item_price, (int, float)) and item_price <= budget:
            reasons.append("预算与商品价格匹配")
        fp = source.get("formatPreference")
        tm = target.get("tradeMethods") or []
        if fp in ("线下", "都可以") and ("自提" in tm or "送货" in tm):
            reasons.append("均支持线下交易")

    if source_type == "NEED" and target_type == "SERVICE":
        fp = source.get("formatPreference")
        formats = target.get("formats") or []
        if fp in ("线下", "都可以") and "线下" in formats:
            reasons.append("均支持线下交易")

    return reasons[:3]
