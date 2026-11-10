"""Extract only audio names and IDs from copies in memory. See docs/剪映草稿.md."""

from contextlib import closing
import ctypes
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import sqlite3
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


def clean_title(value):
    if not isinstance(value, str):
        return ""
    title = " ".join(value.split())[:120]
    if re.fullmatch(r"[a-f0-9]{16,}(?:\.[a-z0-9]+)?|未命名项目|音频|音乐|背景音乐|bgm|audio", title, re.IGNORECASE):
        return ""
    return title


def read_catalog(cache_index, catalogs, material_names):
    if not cache_index:
        return {}
    try:
        with Path(cache_index).open("rb") as source:
            body = json.loads(source.read(2 * 1024 * 1024 + 1))
    except (OSError, ValueError):
        return {}
    if not isinstance(body, dict):
        return {}
    rows = [row for key in ("list", "oldList") if isinstance(body.get(key), list) for row in body[key]]
    mappings = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        file = PurePosixPath(str(row.get("path", "")).replace("\\", "/"))
        resource = str(row.get("resourceId", ""))
        if CACHE_ID.fullmatch(file.stem) and file.suffix.lower() in (".mp3", ".m4a", ".wav", ".flac", ".ogg") and re.fullmatch(r"[0-9]{6,30}", resource):
            mappings.setdefault(file.stem.lower(), set()).add(resource)
    wanted = {value for items in mappings.values() for value in items}
    titles = {}
    for filename in catalogs:
        try:
            with closing(sqlite3.connect(Path(filename).as_uri() + "?mode=ro", uri=True, timeout=1)) as db:
                for body, in db.execute("SELECT response_body FROM http_cache WHERE length(response_body) <= 2097152 ORDER BY timestamp DESC LIMIT 2048"):
                    try:
                        response = json.loads(body)
                        songs = response.get("data", {}).get("songs", [])
                    except (TypeError, ValueError, AttributeError):
                        continue
                    if not isinstance(songs, list):
                        continue
                    for song in songs:
                        if not isinstance(song, dict):
                            continue
                        title = clean_title(song.get("title"))
                        if not title:
                            continue
                        for resource in {str(song.get("id", "")), str(song.get("web_id", ""))} & wanted:
                            titles.setdefault(resource, set()).add(title)
        except (OSError, sqlite3.Error):
            continue
    found = {}
    for key, values in mappings.items():
        if len(values) != 1:
            continue
        resource = next(iter(values))
        candidates = titles.get(resource) or material_names.get(resource) or set()
        if len(candidates) == 1:
            found[key] = next(iter(candidates))
    return found


def read_index(job):
    install = Path(job["install"])
    dll = install / "videoeditor.dll"
    with dll.open("rb") as source:
        if hashlib.file_digest(source, "sha256").hexdigest() != job["dllSha256"]:
            raise ValueError("Installed editor DLL has changed")
    seen = set()
    candidates = {}
    count = 0
    material_names = {}
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
                if Path(filename).name.lower() == "key_value.json":
                    for row in draft.values():
                        if isinstance(row, dict) and row.get("materialCategory") == "audio" and row.get("materialId"):
                            title = clean_title(row.get("materialName"))
                            if title:
                                material_names.setdefault(str(row["materialId"]), set()).add(title)
                    continue
                count += 1
                for audio in (draft.get("materials") or {}).get("audios", []):
                    if not isinstance(audio, dict) or audio.get("type") not in ("music", "sound", "sound_effect"):
                        continue
                    resource = audio.get("effect_id") or audio.get("resource_id")
                    stem = PurePosixPath(str(audio.get("path", "")).replace("\\", "/")).stem
                    title = clean_title(audio.get("name"))
                    if not resource or not CACHE_ID.fullmatch(stem) or not title:
                        continue
                    candidates.setdefault(stem.lower(), set()).add(title)
            except (OSError, ValueError, TypeError, AttributeError):
                continue
    catalog = read_catalog(job.get("cacheIndex"), job.get("catalogs", []), material_names)
    known = {key: next(iter(values)) for key, values in candidates.items() if len(values) == 1}
    known.update(catalog)
    return {"draftsRead": count, "titles": known,
            "titleSources": {key: "jianying-catalog" for key in catalog},
            "conflicts": [key for key, values in candidates.items() if len(values) > 1 and key not in catalog]}



if __name__ == "__main__":
    job = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    Path(sys.argv[2]).write_text(json.dumps(read_index(job), ensure_ascii=False), encoding="utf-8")
