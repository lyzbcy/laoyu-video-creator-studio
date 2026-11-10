"""Extract only audio names and IDs from copies in memory. See docs/剪映草稿.md."""

import ctypes
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import sys

SYMBOL = "?decrypt@EncryptUtils@lvve@@QEAA?AV?$basic_string@DU?$char_traits@D@std@@V?$allocator@D@2@@std@@AEBV34@0AEA_N@Z"
MAX_INPUT = 8 * 1024 * 1024
MAX_OUTPUT = 24 * 1024 * 1024
CACHE_ID = re.compile(r"[a-f0-9]{32}", re.IGNORECASE)


class NativeText(ctypes.Structure):
    _fields_ = [("inline", ctypes.c_ubyte * 16), ("length", ctypes.c_size_t), ("capacity", ctypes.c_size_t)]


def native_arg(data):
    value = NativeText()
    value.length = len(data)
    if len(data) < 16:
        ctypes.memmove(ctypes.byref(value), data, len(data))
        value.capacity = 15
        return value, None
    buffer = ctypes.create_string_buffer(data)
    address = ctypes.c_void_p(ctypes.addressof(buffer))
    ctypes.memmove(ctypes.byref(value), ctypes.byref(address), ctypes.sizeof(address))
    value.capacity = len(data)
    return value, buffer


def read_index(job):
    install = Path(job["install"])
    dll = install / "videoeditor.dll"
    with dll.open("rb") as source:
        if hashlib.file_digest(source, "sha256").hexdigest() != job["dllSha256"]:
            raise ValueError("Installed editor DLL has changed")
    seen = set()
    candidates = {}
    count = 0
    os.environ["PATH"] = str(install) + os.pathsep + os.environ.get("PATH", "")
    with os.add_dll_directory(str(install)):
        library = ctypes.WinDLL(str(dll))
        decrypt = ctypes.WINFUNCTYPE(
            ctypes.c_void_p, ctypes.c_void_p, ctypes.POINTER(NativeText),
            ctypes.POINTER(NativeText), ctypes.POINTER(NativeText), ctypes.POINTER(ctypes.c_bool),
        )((SYMBOL, library))
        options, _ = native_arg(b"{}")
        # Native result storage is owned by the editor runtime and reclaimed on worker exit.
        for filename in job["files"][:300]:
            try:
                with Path(filename).open("rb") as source:
                    raw = source.read(MAX_INPUT + 1)
                if not raw or len(raw) > MAX_INPUT:
                    continue
                key = hashlib.sha256(raw).digest()
                if key in seen:
                    continue
                seen.add(key)
                if raw.lstrip(b"\xef\xbb\xbf \r\n\t")[:1] not in (b"{", b"["):
                    cipher, backing = native_arg(raw)
                    result = NativeText()
                    ok = ctypes.c_bool(False)
                    decrypt(None, ctypes.byref(result), ctypes.byref(cipher), ctypes.byref(options), ctypes.byref(ok))
                    if not ok.value or not 0 < result.length <= min(result.capacity, MAX_OUTPUT):
                        continue
                    address = ctypes.addressof(result) if result.capacity < 16 else ctypes.c_void_p.from_buffer(result).value
                    if not address:
                        continue
                    raw = ctypes.string_at(address, result.length)
                    del backing
                draft = json.loads(raw)
                if not isinstance(draft, dict):
                    continue
                count += 1
                for audio in (draft.get("materials") or {}).get("audios", []):
                    if not isinstance(audio, dict) or audio.get("type") not in ("music", "sound", "sound_effect"):
                        continue
                    resource = audio.get("effect_id") or audio.get("resource_id")
                    stem = PurePosixPath(str(audio.get("path", "")).replace("\\", "/")).stem
                    title = audio.get("name")
                    if not resource or not CACHE_ID.fullmatch(stem) or not isinstance(title, str):
                        continue
                    title = " ".join(title.split())[:120]
                    if not title or re.fullmatch(r"[a-f0-9]{16,}(?:\.[a-z0-9]+)?|未命名项目|音频|音乐|背景音乐|bgm|audio", title, re.IGNORECASE):
                        continue
                    candidates.setdefault(stem.lower(), set()).add(title)
            except (OSError, ValueError, TypeError, AttributeError):
                continue
    return {"draftsRead": count, "titles": {key: next(iter(values)) for key, values in candidates.items() if len(values) == 1},
            "conflicts": [key for key, values in candidates.items() if len(values) > 1]}


if __name__ == "__main__":
    job = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    Path(sys.argv[2]).write_text(json.dumps(read_index(job), ensure_ascii=False), encoding="utf-8")
