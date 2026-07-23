from app import matching


def test_build_resource_text_excludes_contact():
    text = matching.build_resource_text("ITEM", {
        "title": "显示器", "category": "数码电子", "condition": "全新",
        "contactInfo": "微信:SECRET_PHONE", "contactVisibility": "VERIFIED_ONLY", "realName": "张三",
    })
    assert "SECRET_PHONE" not in text
    assert "张三" not in text
    assert "VERIFIED_ONLY" not in text
    assert "数码电子" in text


def test_reasons_need_item_all_three():
    r = matching.build_reasons(
        {"reward": "500元", "formatPreference": "线下"},
        {"price": 400, "priceMode": "SPECIFIC", "tradeMethods": ["自提"]},
        "NEED", "ITEM", 0.7,
    )
    assert "内容语义高度相关" in r
    assert "预算与商品价格匹配" in r
    assert "均支持线下交易" in r
    assert len(r) <= 3


def test_reasons_low_score_none():
    r = matching.build_reasons(
        {"reward": "面议", "formatPreference": "线上"},
        {"price": 999, "priceMode": "SPECIFIC", "tradeMethods": ["邮寄"]},
        "NEED", "ITEM", 0.2,
    )
    assert r == []


def test_reasons_free_item_budget_ok():
    r = matching.build_reasons(
        {"reward": "面议", "formatPreference": "线下"},
        {"priceMode": "FREE", "tradeMethods": ["自提"]},
        "NEED", "ITEM", 0.3,
    )
    assert "对方免费赠送，符合预算" in r


def test_reasons_item_to_need_only_semantic():
    r = matching.build_reasons(
        {"tradeMethods": ["自提"], "price": 100, "priceMode": "SPECIFIC"},
        {"reward": "200元", "formatPreference": "线下"},
        "ITEM", "NEED", 0.8,
    )
    assert r == ["内容语义高度相关"]


def test_reasons_only_from_template():
    allowed = {"内容语义高度相关", "预算与商品价格匹配", "对方免费赠送，符合预算", "均支持线下交易"}
    r = matching.build_reasons(
        {"reward": "500元", "formatPreference": "线下"},
        {"price": 400, "priceMode": "SPECIFIC", "tradeMethods": ["自提"]},
        "NEED", "ITEM", 0.7,
    )
    assert set(r).issubset(allowed)
