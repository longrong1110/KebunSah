import math
import time

import pytest

from worker.earthengine import (DATASET, EarthEngineForest, ForestStats, buffer_radius_m, risk_level, to_result)


def stats(area=4.0, forest=4.0, loss=0.0):
    return ForestStats(area_ha=area, forest_2020_ha=forest, loss_after_2020_ha=loss)


@pytest.mark.parametrize("loss,expected", [
    (0.0, "low"),
    (0.01, "low"),  # 一个像素以内当噪声
    (0.02, "medium"),  # 有损失但很小
    (0.09, "medium"),
    (0.10, "high"),  # 0.1 公顷起算明显
    (0.5, "high"),
    (3.56, "high"),
])
def test_risk_levels_on_a_four_hectare_plot(loss, expected):
    assert risk_level(stats(area=4.0, forest=4.0, loss=loss)) == expected


def test_small_loss_on_a_tiny_plot_is_high_when_it_is_a_big_share():
    assert risk_level(stats(area=0.5, forest=0.5, loss=0.04)) == "high"  # 8% of the plot
    assert risk_level(stats(area=4.0, forest=4.0, loss=0.04)) == "medium"  # 1%


def test_zero_area_is_never_low_when_there_is_loss():
    assert risk_level(stats(area=0.0, forest=0.0, loss=0.5)) == "high"


def test_result_numbers_and_dataset():
    r = to_result(stats(area=3.97, forest=3.97, loss=3.56))
    assert r.risk == "high" and r.cover_2020_pct == 100.0 and r.loss_after_2020_ha == 3.56
    assert r.dataset == DATASET and "JRC/GFC2020" in r.dataset and "hansen" in r.dataset
    plantation = to_result(stats(area=8.94, forest=0.0, loss=0.0))
    assert plantation.risk == "low" and plantation.cover_2020_pct == 0.0 and plantation.loss_after_2020_ha == 0.0


def test_cover_is_clamped_to_0_100():
    assert to_result(stats(area=1.0, forest=1.2, loss=0)).cover_2020_pct == 100.0


def test_buffer_radius_gives_the_same_area():
    for ha in (0.5, 3.0, 3.99):
        r = buffer_radius_m(ha)
        assert math.pi * r * r == pytest.approx(ha * 10_000, rel=1e-9)


def test_screen_passes_the_plot_to_compute_and_maps_the_answer():
    calls = []

    def compute(lat, lng, ring, area):
        calls.append((lat, lng, ring, area))
        return stats(area=3.97, forest=3.97, loss=3.56)

    ef = EarthEngineForest("p", compute=compute)
    r = ef.screen(3.6654, 102.959, [[102.95, 3.66], [102.96, 3.66], [102.96, 3.67], [102.95, 3.66]], 3.97)
    assert r.risk == "high" and r.dataset == DATASET
    assert calls == [(3.6654, 102.959, [[102.95, 3.66], [102.96, 3.66], [102.96, 3.67], [102.95, 3.66]], 3.97)]
    ef.screen(4.3, 101.15, None, 3.0)  # 只记一个点
    assert calls[-1] == (4.3, 101.15, None, 3.0)


def test_failures_are_raised_so_the_pipeline_can_degrade():
    def boom(*a):
        raise RuntimeError("403 not registered")

    with pytest.raises(RuntimeError):
        EarthEngineForest("p", compute=boom).screen(4.3, 101.15, None, 3.0)


def test_slow_answers_time_out():
    def slow(*a):
        time.sleep(1.0)
        return stats()

    with pytest.raises(TimeoutError):
        EarthEngineForest("p", timeout_s=0.1, compute=slow).screen(4.3, 101.15, None, 3.0)
