import pytest

from kebunsah_core.masking import hash_ic, last4_of, mask_ic, mask_ic_in_text
from kebunsah_core.params import DEFAULT_PARAMS, params_from_config


def test_hash_ic_with_an_empty_pepper_matches_the_seed():
    # seed 里 TAN AH KOW（虚构）的 ic_hash；空 pepper 只用于测试 / 对齐 seed
    assert hash_ic("720304075117", pepper="") == "264097fe0da9af30e5b9c2b1e3a71df3ac16ba8ea651a179eb0438742a4475cd"


def test_hash_ic_ignores_dashes_and_changes_with_pepper():
    assert hash_ic("720304-07-5117", pepper="") == hash_ic("720304075117", pepper="")
    assert hash_ic("720304075117", pepper="s3cret") != hash_ic("720304075117", pepper="")


def test_hash_ic_requires_a_pepper():
    with pytest.raises(TypeError):
        hash_ic("720304075117")  # type: ignore[call-arg]


@pytest.mark.parametrize("bad", ["", "12345", "7203040751171", "７２０３０４０７５１１７", None])
def test_hash_ic_rejects_anything_but_twelve_ascii_digits(bad):
    # 全角数字以前会走到 .encode("ascii") 抛 UnicodeEncodeError（恰好也是 ValueError），所以要认我们自己的报错信息
    with pytest.raises(ValueError, match="12 ASCII digits"):
        hash_ic(bad, pepper="")


def test_hash_ic_accepts_a_non_ascii_pepper():
    h = hash_ic("720304075117", pepper="秘密")
    assert len(h) == 64 and h != hash_ic("720304075117", pepper="")


def test_last4_and_mask():
    assert last4_of("720304-07-5117") == "5117"
    assert mask_ic("5117") == "******-**-5117"


def test_last4_of_counts_ascii_digits_only():
    assert last4_of("５１１７") == ""
    assert last4_of("abc") == ""


@pytest.mark.parametrize("bad", ["720304075117", "12a4", "５１１７", "123", ""])
def test_mask_ic_refuses_anything_but_four_ascii_digits(bad):
    with pytest.raises(ValueError, match="4 ASCII digits"):
        mask_ic(bad)


def test_mask_ic_in_text_masks_full_numbers_only():
    assert mask_ic_in_text("IC 720304-07-5117 dan 800512085231.") == "IC ******-**-5117 dan ******-**-5231."
    assert mask_ic_in_text("Lot 2217, 3.04 Hektar, MSPO 570158") == "Lot 2217, 3.04 Hektar, MSPO 570158"
    assert mask_ic_in_text("licence 810268659837") == "licence ******-**-9837"  # 12 位数字一律当身份证号打码


def test_mask_ic_in_text_leaves_fullwidth_digits_alone():
    text = "IC ７２０３０４０７５１１７"
    assert mask_ic_in_text(text) == text


def test_default_params_match_schema_rule_params():
    p = DEFAULT_PARAMS
    assert (p.area_tolerance_pct, p.area_tolerance_min_ha, p.area_fail_over_pct) == (10, 0.1, 50)
    assert (p.expiry_warn_days, p.name_similarity_min, p.confidence_min) == (90, 0.85, 0.7)
    assert (p.point_max_ha, p.smallholder_max_ha) == (4, 40.46)


def test_params_from_config_reads_values_and_falls_back():
    doc = {"CC-01": {"area_tolerance_pct": {"value": 12, "unit": "%", "basis": "team", "note": "x"}},
           "CC-02": {"expiry_warn_days": {"value": 60}}, "bogus": 1}
    p = params_from_config(doc)
    assert p.area_tolerance_pct == 12 and p.expiry_warn_days == 60
    assert p.name_similarity_min == 0.85  # 没给的用默认值
    assert params_from_config(None) == DEFAULT_PARAMS
