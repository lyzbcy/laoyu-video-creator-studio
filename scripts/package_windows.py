"""Package the Windows desktop preview from a cached Electron distribution."""

import hashlib
import json
import os
from pathlib import Path, PureWindowsPath
import shutil
import subprocess
import tempfile
from zipfile import ZipFile

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
LOCAL = Path(os.environ["LOCALAPPDATA"])
PROGRAMS = LOCAL / "Programs" / "LaoyuCreatorStudio"
PACKAGE = json.loads((ROOT / "package.json").read_text(encoding="utf-8-sig"))
EXE = "LaoyuCreatorStudio.exe"


def write_identity(exe, version):
    with exe.open("rb") as stream:
        sha256 = hashlib.file_digest(stream, "sha256").hexdigest()
    marker = {
        "schema": 1,
        "kind": "laoyu-private-tool",
        "id": PACKAGE["name"],
        "version": version,
        "executable": exe.name,
        "sha256": sha256,
    }
    (exe.parent / "laoyu-private-tool.json").write_text(
        json.dumps(marker, indent=2) + "\n", encoding="utf-8"
    )


def package():
    version = PACKAGE["version"]
    electron = PACKAGE["devDependencies"]["electron"]
    archive_name = f"electron-v{electron}-win32-x64.zip"
    archive = next(iter(sorted((LOCAL / "electron" / "Cache").rglob(archive_name))), None)
    if archive is None:
        raise SystemExit(f"Missing {archive_name} in the local Electron cache.")
    rcedit = next(iter(sorted((LOCAL / "electron-builder" / "Cache" / "winCodeSign").rglob("rcedit-x64.exe"))), None)
    if rcedit is None:
        raise SystemExit("Missing rcedit-x64.exe in the local electron-builder cache.")

    PROGRAMS.mkdir(parents=True, exist_ok=True)
    destination = PROGRAMS / version
    if destination.exists():
        raise SystemExit(f"A package already exists at {destination}.")
    with tempfile.TemporaryDirectory(prefix="studio-build-", dir=PROGRAMS) as scratch:
        staging = Path(scratch) / "app"
        with ZipFile(archive) as runtime:
            for entry in runtime.infolist():
                name = PureWindowsPath(entry.filename)
                if name.anchor or ".." in name.parts or any(":" in part for part in name.parts):
                    raise ValueError(f"Unexpected runtime entry {entry.filename}")
            runtime.extractall(staging)
        runtime_version = (staging / "version").read_text(encoding="utf-8").strip().lstrip("v")
        if runtime_version != electron:
            raise ValueError(f"Expected Electron {electron}, found {runtime_version}.")

        resources = staging / "resources"
        (resources / "default_app.asar").unlink()
        app = resources / "app"
        src = app / "src"
        src.mkdir(parents=True)
        shutil.copy2(ROOT / "package.json", app)
        for name in ("desktop.mjs", "server.mjs", "feedback.mjs", "diagnostics.mjs", "knowledge.mjs", "market.mjs", "market-catalog.json"):
            shutil.copy2(ROOT / "src" / name, src)
        for name in ("public", "tagger"):
            shutil.copytree(ROOT / "src" / name, src / name)

        icon = Path(scratch) / "app.ico"
        with Image.open(src / "public" / "logo.png") as logo:
            logo.save(icon, sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
        exe = (staging / "electron.exe").rename(staging / EXE)
        product = PACKAGE["productName"]
        pe_version = version.split("-", 1)[0] + ".0"
        subprocess.run([
            str(rcedit), str(exe), "--set-icon", str(icon),
            "--set-version-string", "ProductName", product,
            "--set-version-string", "FileDescription", product,
            "--set-version-string", "OriginalFilename", EXE,
            "--set-file-version", pe_version, "--set-product-version", pe_version,
        ], check=True, creationflags=subprocess.CREATE_NO_WINDOW)
        write_identity(exe, version)
        staging.rename(destination)
    print(destination / EXE)


if __name__ == "__main__":
    package()
