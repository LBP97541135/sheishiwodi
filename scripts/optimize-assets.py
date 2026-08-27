from __future__ import annotations

import argparse
from pathlib import Path
import subprocess

from PIL import Image, ImageOps


ROOT = Path(__file__).resolve().parents[1]
ASSET_ROOT = ROOT / "apps" / "web" / "src" / "assets"
CHARACTER_ROOT = ASSET_ROOT / "characters"
ROLES = ("deepseek", "doubao", "qwen", "human-male", "human-female")
STATES = ("idle", "thinking", "speaking", "suspected", "eliminated")
ACTION_SIZE = (512, 640)
AVATAR_SIZE = (256, 256)
QUALITY = 84


def normalized_mode(image: Image.Image) -> str:
    return "RGBA" if "A" in image.getbands() else "RGB"


def save_webp(image: Image.Image, output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    image.save(output, "WEBP", quality=QUALITY, method=6, exact=True)


def convert_character(role: str, source_root: Path) -> None:
    role_dir = CHARACTER_ROOT / role
    source_dir = source_root / "characters" / role
    for state in STATES:
        source = source_dir / f"{state}.png"
        with Image.open(source) as opened:
            image = opened.convert(normalized_mode(opened))
            action = ImageOps.fit(
                image,
                ACTION_SIZE,
                method=Image.Resampling.LANCZOS,
                centering=(0.5, 0.5),
            )
            save_webp(action, role_dir / f"{state}.webp")

            if state == "idle":
                avatar = ImageOps.fit(
                    image,
                    AVATAR_SIZE,
                    method=Image.Resampling.LANCZOS,
                    centering=(0.5, 0.2),
                )
                save_webp(avatar, role_dir / "avatar.webp")


def convert_scene(source_root: Path) -> None:
    source = source_root / "scenes" / "interrogation-room.png"
    with Image.open(source) as opened:
        scene = opened.convert(normalized_mode(opened))
        save_webp(scene, ASSET_ROOT / "scenes" / "interrogation-room.webp")


def convert_audio(source_root: Path, ffmpeg: Path) -> None:
    source = source_root / "audio" / "game-bgm.wav"
    output = ASSET_ROOT / "audio" / "game-bgm.mp3"
    subprocess.run(
        [
            str(ffmpeg),
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(source),
            "-map_metadata",
            "-1",
            "-codec:a",
            "libmp3lame",
            "-b:a",
            "128k",
            str(output),
        ],
        check=True,
    )


def check_outputs() -> None:
    failures: list[str] = []
    total_bytes = 0
    for role in ROLES:
        for state in STATES:
            path = CHARACTER_ROOT / role / f"{state}.webp"
            expected_size = ACTION_SIZE
            try:
                with Image.open(path) as image:
                    image.load()
                    if image.format != "WEBP" or image.size != expected_size:
                        failures.append(f"{path}: expected WEBP {expected_size}, got {image.format} {image.size}")
            except Exception as error:  # noqa: BLE001 - report every corrupt output together
                failures.append(f"{path}: {error}")
            else:
                total_bytes += path.stat().st_size

        avatar = CHARACTER_ROOT / role / "avatar.webp"
        try:
            with Image.open(avatar) as image:
                image.load()
                if image.format != "WEBP" or image.size != AVATAR_SIZE:
                    failures.append(f"{avatar}: expected WEBP {AVATAR_SIZE}, got {image.format} {image.size}")
        except Exception as error:  # noqa: BLE001
            failures.append(f"{avatar}: {error}")
        else:
            total_bytes += avatar.stat().st_size

    scene = ASSET_ROOT / "scenes" / "interrogation-room.webp"
    try:
        with Image.open(scene) as image:
            image.load()
            if image.format != "WEBP":
                failures.append(f"{scene}: expected WEBP, got {image.format}")
    except Exception as error:  # noqa: BLE001
        failures.append(f"{scene}: {error}")
    else:
        total_bytes += scene.stat().st_size

    audio = ASSET_ROOT / "audio" / "game-bgm.mp3"
    if not audio.is_file() or audio.stat().st_size == 0:
        failures.append(f"{audio}: missing or empty")

    if failures:
        raise SystemExit("\n".join(failures))
    print(f"verified 25 action images, 5 avatars and 1 scene ({total_bytes / 1024 / 1024:.2f} MiB)")


def main() -> None:
    parser = argparse.ArgumentParser(description="Normalize committed game images to production WebP assets.")
    parser.add_argument("--check", action="store_true", help="validate existing outputs without rewriting them")
    parser.add_argument(
        "--source-root",
        type=Path,
        default=ASSET_ROOT,
        help="directory containing characters/, scenes/ and audio/ source assets",
    )
    parser.add_argument("--ffmpeg", type=Path, help="optional ffmpeg executable used to rebuild game-bgm.mp3")
    args = parser.parse_args()

    if not args.check:
        for role in ROLES:
            convert_character(role, args.source_root)
        convert_scene(args.source_root)
        if args.ffmpeg:
            convert_audio(args.source_root, args.ffmpeg)
    check_outputs()


if __name__ == "__main__":
    main()
