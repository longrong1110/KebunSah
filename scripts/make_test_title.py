"""生成一张「地契单页」仿真样本：面积和持有人在同一页，用来测试屏 3 一份文件一张照片的主线。

seed/photos 里的地契是两页（第 1 页有面积、第 2 页有持有人），但屏 3 每种文件只能放一张照片，
拿其中任何一页单独上传，评估都会因为缺面积或缺持有人而变成「需人工复核」。这张图把两样都放在一页。
内容与黄色演示地块一致（HSM 2217/91、Lot 2217、3.04 公顷、持有人 AHMAD ZAKI BIN ROSLI）。
虚构数据，带「SIMULATED / CONTOH」水印；不仿真官方印章和徽章。

用法（仓库根目录）：python scripts/make_test_title.py   →  seed/photos/title-5-single-page.jpg
需要 Pillow：python -m pip install pillow（只有这个脚本用到，没放进 requirements）。
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parents[1] / "seed" / "photos" / "title-5-single-page.jpg"
FONTS = Path("C:/Windows/Fonts")
W, H = 1200, 1650

ROWS = [
    ("No. Hakmilik", "HSM 2217/91"),
    ("No. Lot", "2217"),
    ("Mukim / Daerah", "Kampar / Kampar"),
    ("Negeri", "Perak"),
    ("Keluasan", "3.04 Hektar"),
    ("Kategori penggunaan", "Pertanian"),
    ("Tempoh pemilikan", "Selama-lamanya"),
    ("Pemilik berdaftar", "AHMAD ZAKI BIN ROSLI"),
]


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    try:
        return ImageFont.truetype(str(FONTS / name), size)
    except OSError:
        return ImageFont.load_default()


def main() -> None:
    img = Image.new("RGB", (W, H), (236, 232, 220))  # 桌面
    page = Image.new("RGB", (W - 160, H - 160), (252, 250, 243))
    d = ImageDraw.Draw(page)
    pw, ph = page.size
    d.rectangle([20, 20, pw - 20, ph - 20], outline=(60, 60, 60), width=4)
    d.text((pw // 2, 110), "GERAN (CONTOH SIMULASI)", font=font("timesbd.ttf", 54), fill=(30, 30, 30), anchor="mm")
    d.text((pw // 2, 175), "Hakmilik tanah — tiruan untuk ujian", font=font("times.ttf", 32), fill=(70, 70, 70), anchor="mm")
    y = 300
    for label, value in ROWS:
        d.text((90, y), label, font=font("times.ttf", 38), fill=(60, 60, 60))
        d.text((520, y), value, font=font("cour.ttf", 44), fill=(15, 15, 15))
        d.line([(90, y + 62), (pw - 90, y + 62)], fill=(180, 180, 180), width=2)
        y += 120
    d.text((pw // 2, ph - 120), "Dokumen simulasi — bukan dokumen sebenar", font=font("times.ttf", 30), fill=(110, 110, 110), anchor="mm")

    mark = Image.new("RGBA", page.size, (0, 0, 0, 0))
    ImageDraw.Draw(mark).text((pw // 2, ph // 2), "SIMULATED / CONTOH", font=font("arial.ttf", 96), fill=(200, 40, 40, 70), anchor="mm")
    mark = mark.rotate(32, resample=Image.BICUBIC)
    page = Image.alpha_composite(page.convert("RGBA"), mark).convert("RGB")

    img.paste(page.rotate(-1.2, resample=Image.BICUBIC, expand=False, fillcolor=(236, 232, 220)), (80, 80))
    img.save(OUT, "JPEG", quality=88)
    print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
