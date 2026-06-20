#!/usr/bin/env python3
"""
Generates a text image, OCRs it with tesseract, and checks that the
reflow rule in ocrProcessor.js's _reflowText (single '\n' -> space,
'\n\n' -> paragraph break) actually holds for real tesseract output.

ocrProcessor.js can't be imported/run outside GNOME Shell (it imports
gi://Gio etc.), so this exercises the same assumption directly against
the tesseract binary instead. Run: python3 tests/test_ocr_reflow.py
"""
import re
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

PARAGRAPH_ONE = (
    "This is a long sentence that should wrap onto a second line "
    "when rendered in a narrow image."
)
PARAGRAPH_TWO = "This is a separate paragraph."


def reflow(text):
    paragraphs = re.split(r"\n{2,}", text)
    out = []
    for p in paragraphs:
        p = re.sub(r"\n", " ", p)
        p = re.sub(r" {2,}", " ", p).strip()
        if p:
            out.append(p)
    return "\n\n".join(out)


FONT_PATH = "/usr/share/fonts/liberation-sans-fonts/LiberationSans-Regular.ttf"


def make_test_image(path):
    img = Image.new("RGB", (700, 220), "white")
    draw = ImageDraw.Draw(img)
    font = ImageFont.truetype(FONT_PATH, 28)
    lines = [
        "This is a long sentence that should wrap",
        "onto a second line when rendered in a",
        "narrow image.",
        "",
        "This is a separate paragraph.",
    ]
    y = 15
    for line in lines:
        draw.text((15, y), line, fill="black", font=font)
        y += 38
    img.save(path)


def run_tesseract(image_path):
    result = subprocess.run(
        ["tesseract", str(image_path), "stdout"],
        capture_output=True, text=True, check=True,
    )
    return result.stdout


def main():
    with tempfile.TemporaryDirectory() as tmp:
        image_path = Path(tmp) / "test.png"
        make_test_image(image_path)
        raw = run_tesseract(image_path)
        result = reflow(raw)

    paragraphs = result.split("\n\n")
    assert len(paragraphs) == 2, f"expected 2 paragraphs, got {len(paragraphs)}: {paragraphs!r}"
    assert "\n" not in paragraphs[0], f"line-wrap not joined: {paragraphs[0]!r}"
    assert PARAGRAPH_TWO.rstrip(".") in paragraphs[1], f"second paragraph mismatch: {paragraphs[1]!r}"
    print("OK:", paragraphs)


if __name__ == "__main__":
    main()
