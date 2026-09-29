"""Bake seamless water, reflection, rain and ripple motion into Water theme videos.

The mini program plays these MP4 files directly as the page background. Motion is
part of the media itself; no decorative DOM layer is used to fake a moving scene.
"""

from __future__ import annotations

import math
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = Path.home() / ".codex/generated_images/01a0986d-3233-7d01-8863-a9c14aab25f2"
OUTPUT_ROOT = ROOT / "apps/wechat/src/packageThemeScenes/assets"
WIDTH, HEIGHT, FPS, SECONDS = 432, 768, 16, 6

SCENES = {
    "home": ("exec-4eb50048-36e7-47ff-80f7-c6c28b58d10d.png", 0.24, False),
    "stats": ("exec-cead69d0-980d-4d1a-a282-7fd8e8c89263.png", 0.12, False),
    "community": ("exec-a5ec7f80-b703-4197-a605-4321250a603c.png", 0.18, True),
    "profile": ("exec-d65afce4-14ba-4ccf-bb77-92c280505079.png", 0.38, False),
}


def cover(image: Image.Image) -> Image.Image:
    ratio = max(WIDTH / image.width, HEIGHT / image.height)
    resized = image.resize((round(image.width * ratio), round(image.height * ratio)), Image.Resampling.LANCZOS)
    left = (resized.width - WIDTH) // 2
    top = (resized.height - HEIGHT) // 2
    return resized.crop((left, top, left + WIDTH, top + HEIGHT)).convert("RGB")


def soft_water_mask(rgb: np.ndarray, start: float, scene: str) -> np.ndarray:
    y = np.arange(HEIGHT, dtype=np.float32)[:, None] / HEIGHT
    feather = np.clip((y - start) / 0.12, 0, 1)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    blue = np.clip((b.astype(np.float32) - r.astype(np.float32) * 0.82 + 28) / 72, 0, 1)
    luminance = (r.astype(np.float32) + g.astype(np.float32) + b.astype(np.float32)) / (3 * 255)
    mask = feather * np.clip(blue * 0.7 + luminance * 0.22, 0, 1)
    if scene == "profile":
        mask *= np.clip((y - 0.42) / 0.18, 0, 1)
    return Image.fromarray(np.uint8(mask * 255)).filter(ImageFilter.GaussianBlur(8))


def rain_layer(frame: int, total: int) -> np.ndarray:
    canvas = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    rng = np.random.default_rng(4107)
    xs = rng.integers(-30, WIDTH + 30, 130)
    starts = rng.integers(-HEIGHT, HEIGHT, 130)
    speeds = rng.integers(8, 17, 130)
    lengths = rng.integers(12, 35, 130)
    alpha = rng.integers(20, 76, 130)
    for x, start, speed, length, opacity in zip(xs, starts, speeds, lengths, alpha):
        y = int((start + frame * speed) % (HEIGHT + 140) - 70)
        draw.line((int(x), y, int(x - 3), y + int(length)), fill=(170, 220, 235, int(opacity)), width=1)
    phase = frame / total
    for cx_ratio, cy_ratio, offset in ((0.22, 0.57, 0.05), (0.71, 0.65, 0.42), (0.51, 0.80, 0.73)):
        cx, cy = int(WIDTH * cx_ratio), int(HEIGHT * cy_ratio)
        progress = (phase + offset) % 1
        radius = 6 + progress * 55
        opacity = int(70 * (1 - progress) ** 1.8)
        draw.ellipse((cx - radius, cy - radius * 0.28, cx + radius, cy + radius * 0.28), outline=(165, 228, 242, opacity), width=2)
    return np.asarray(canvas, dtype=np.uint8)


def render_scene(name: str, source_name: str, start: float, rainy: bool) -> None:
    source = cover(Image.open(SOURCE_ROOT / source_name))
    original = np.asarray(source, dtype=np.uint8)
    mask = np.asarray(soft_water_mask(original, start, name), dtype=np.float32)[..., None] / 255
    total = FPS * SECONDS
    yy, xx = np.indices((HEIGHT, WIDTH), dtype=np.float32)
    output = OUTPUT_ROOT / f"water-{name}-v4.mp4"
    poster = OUTPUT_ROOT / f"water-{name}-v4.webp"

    command = [
        "ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
        "-s", f"{WIDTH}x{HEIGHT}", "-r", str(FPS), "-i", "-", "-an", "-c:v", "libx264",
        "-preset", "medium", "-crf", "29", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(output),
    ]
    process = subprocess.Popen(command, stdin=subprocess.PIPE)
    assert process.stdin is not None

    for frame_index in range(total):
        angle = 2 * math.pi * frame_index / total
        row_shift = (
            7.2 * np.sin(yy[:, 0] * 0.045 + angle * 2)
            + 3.4 * np.sin(yy[:, 0] * 0.017 - angle * 3)
        ).astype(np.int16)
        col_shift = (2.8 * np.sin(xx[0] * 0.031 - angle * 2)).astype(np.int16)
        x_index = (np.arange(WIDTH)[None, :] - row_shift[:, None]) % WIDTH
        horizontally_shifted = original[np.arange(HEIGHT)[:, None], x_index]
        y_index = (np.arange(HEIGHT)[:, None] - col_shift[None, :]) % HEIGHT
        shifted = horizontally_shifted[y_index, np.arange(WIDTH)[None, :]]

        frame = original.astype(np.float32) * (1 - mask) + shifted.astype(np.float32) * mask
        caustic = (
            np.sin(xx * 0.051 + yy * 0.016 + angle * 2.0)
            + np.sin(xx * 0.019 - yy * 0.031 - angle * 3.0)
            + np.sin(xx * 0.009 + yy * 0.047 + angle)
        )
        caustic = np.clip((caustic - 0.9) * 15, 0, 34)[..., None] * mask
        frame[..., 1:3] += caustic

        slow_glow = (0.5 + 0.5 * np.sin(xx * 0.012 + yy * 0.009 - angle * 2.0))[..., None]
        frame += slow_glow * mask * np.array([1.5, 7.0, 11.0], dtype=np.float32)

        if rainy:
            rain = rain_layer(frame_index, total)
            alpha = rain[..., 3:4].astype(np.float32) / 255
            frame = frame * (1 - alpha) + rain[..., :3].astype(np.float32) * alpha

        rendered = np.uint8(np.clip(frame, 0, 255))
        if frame_index == 0:
            Image.fromarray(rendered).save(poster, "WEBP", quality=82, method=6)
        process.stdin.write(rendered.tobytes())

    process.stdin.close()
    if process.wait() != 0:
        raise RuntimeError(f"ffmpeg failed for {name}")
    print(f"generated {output.name}: {output.stat().st_size:,} bytes")


if __name__ == "__main__":
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    for scene_name, config in SCENES.items():
        render_scene(scene_name, *config)
