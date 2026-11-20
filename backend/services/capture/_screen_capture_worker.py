"""独立子进程内截屏，避免在主进程/终端线程上触发图形栈；Windows 下父进程用 CREATE_NO_WINDOW 启动，无控制台窗口。
支持区域：full, left_half, right_half, top_half, bottom_half（通过 argv[1] 传入）。"""
from __future__ import annotations

import base64
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


def _region_for_monitor(mon: dict, kind: str) -> dict:
    """根据 kind 计算主显示器上的截取区域。"""
    left, top = mon["left"], mon["top"]
    w, h = mon["width"], mon["height"]
    if kind == "full":
        return {"left": left, "top": top, "width": w, "height": h}
    if kind == "left_half":
        return {"left": left, "top": top, "width": max(1, w // 2), "height": h}
    if kind == "right_half":
        half = w // 2
        return {"left": left + half, "top": top, "width": max(1, w - half), "height": h}
    if kind == "top_half":
        return {"left": left, "top": top, "width": w, "height": max(1, h // 2)}
    if kind == "bottom_half":
        half = h // 2
        return {"left": left, "top": top + half, "width": w, "height": max(1, h - half)}
    # 默认左半屏
    return {"left": left, "top": top, "width": max(1, w // 2), "height": h}


def _encode_capture(shot, max_long_edge: int) -> dict:
    try:
        from PIL import Image
    except ImportError:
        import mss.tools

        width, height = shot.size
        png = mss.tools.to_png(shot.rgb, shot.size)
        return {
            "mime": "image/png",
            "data": base64.b64encode(png).decode("ascii"),
            "width": width,
            "height": height,
            "original_width": width,
            "original_height": height,
            "original_bytes": width * height * 3,
            "encoded_bytes": len(png),
            "compressed": False,
            "fallback": "pillow_missing",
        }

    return _encode_image(Image.frombytes("RGB", shot.size, shot.rgb), max_long_edge)


def _encode_image(image, max_long_edge: int) -> dict:
    from PIL import Image

    original_width, original_height = image.size
    long_edge = max(image.size)
    if 0 < max_long_edge < long_edge:
        scale = max_long_edge / long_edge
        new_size = tuple(max(1, round(side * scale)) for side in image.size)
        image = image.resize(new_size, Image.Resampling.LANCZOS)
    out = io.BytesIO()
    image.save(out, format="JPEG", quality=88, optimize=True)
    encoded = out.getvalue()
    return {
        "mime": "image/jpeg",
        "data": base64.b64encode(encoded).decode("ascii"),
        "width": image.size[0],
        "height": image.size[1],
        "original_width": original_width,
        "original_height": original_height,
        "original_bytes": original_width * original_height * 3,
        "encoded_bytes": len(encoded),
        "compressed": True,
        "fallback": "",
    }


def _capture_wayland(region_kind: str, max_long_edge: int) -> dict:
    desktop = os.environ.get("XDG_CURRENT_DESKTOP", "").lower().split(":")
    if not ("kde" in desktop or os.environ.get("KDE_FULL_SESSION") == "true"):
        raise RuntimeError("当前 Wayland 桌面不支持自动截屏，请使用系统截图工具后上传图片")

    spectacle = shutil.which("spectacle")
    if spectacle is None:
        raise RuntimeError("KDE Wayland 截屏需要 Spectacle，请安装 spectacle")
    from PIL import Image

    with tempfile.TemporaryDirectory(prefix="ia-screen-") as temp_dir:
        screenshot = Path(temp_dir) / "capture.png"
        proc = subprocess.run(
            [spectacle, "--new-instance", "--background", "--nonotify", "--current", "--output", str(screenshot)],
            capture_output=True,
            text=True,
            timeout=12,
            env={**os.environ, "QT_QPA_PLATFORM": "wayland"},
        )
        if proc.returncode != 0 or not screenshot.is_file():
            detail = proc.stderr.strip() or f"未生成截图（退出码 {proc.returncode}）"
            raise RuntimeError(f"Spectacle 截屏失败。{detail}")
        with Image.open(screenshot) as image:
            region = _region_for_monitor(
                {"left": 0, "top": 0, "width": image.width, "height": image.height}, region_kind
            )
            left, top = region["left"], region["top"]
            cropped = image.crop((left, top, left + region["width"], top + region["height"]))
            return _encode_image(cropped.convert("RGB"), max_long_edge)


def main() -> None:
    region_kind = (sys.argv[1] or "left_half").strip() if len(sys.argv) > 1 else "left_half"
    if region_kind not in ("full", "left_half", "right_half", "top_half", "bottom_half"):
        region_kind = "left_half"
    try:
        max_long_edge = int(sys.argv[2]) if len(sys.argv) > 2 else 1600
    except (TypeError, ValueError):
        max_long_edge = 1600
    try:
        if sys.platform == "linux" and (
            os.environ.get("XDG_SESSION_TYPE") == "wayland" or os.environ.get("WAYLAND_DISPLAY")
        ):
            payload = _capture_wayland(region_kind, max_long_edge)
        else:
            try:
                import mss
            except ImportError:
                print("mss missing", file=sys.stderr)
                sys.exit(2)
            with mss.mss() as sct:
                if len(sct.monitors) < 2:
                    print("no monitor", file=sys.stderr)
                    sys.exit(3)
                region = _region_for_monitor(sct.monitors[1], region_kind)
                shot = sct.grab(region)
                payload = _encode_capture(shot, max_long_edge)
    except Exception as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)
    sys.stdout.write(json.dumps(payload, separators=(",", ":")))
    sys.stdout.buffer.flush()


if __name__ == "__main__":
    main()
