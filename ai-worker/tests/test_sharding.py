from app import sharding


def test_shard_even_distribution():
    s = sharding.shard(list(range(10)), 3)
    assert len(s) == 3
    flat = sorted(x for b in s for x in b)
    assert flat == list(range(10))


def test_shard_n_zero_clamps_to_one():
    s = sharding.shard([1, 2, 3], 0)
    assert len(s) == 1
    assert s[0] == [1, 2, 3]


def test_shard_more_shards_than_items():
    s = sharding.shard([1, 2], 5)
    # 空分片被丢弃 → 只剩有元素的 2 个
    assert len(s) == 2


def test_should_retry_boundary():
    assert sharding.should_retry(1, 3) is True
    assert sharding.should_retry(2, 3) is True
    assert sharding.should_retry(3, 3) is False  # 达到上限不再重试
    assert sharding.should_retry(4, 3) is False
