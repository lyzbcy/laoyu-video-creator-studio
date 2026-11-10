// 捞鱼打标工具 · 同步服务器
// 作用：动态扫描剪映音乐缓存目录（+本地副本目录），生成增量清单，
//       让打标工具自动带出剪映新缓存——不用手动选文件夹。
// 启动：双击「启动打标工具.bat」，或命令行 node sync-server.js
const http = require("http");
const fs = require("fs");
const path = require("path");
const { readLegacyLibrary, saveLegacyDatabase } = require("./legacy-source.js");

const TOOL_DIR = __dirname;
const DATA_DIR = process.env.LAOYU_STUDIO_DATA;

// 扫描目录：自动发现，不再写死。三路探测（结果缓存 5 分钟）：
//   1) 默认位置：%LOCALAPPDATA%\JianyingPro\User Data\Cache\music
//   2) 工具目录旁的「剪映本地缓存」（手动整理的副本，老行为保留）
//   3) 全盘浅扫（深度≤3、每盘≤3000 目录）：剪映里改过缓存位置的话，
//      自选目录下会有 JianyingPro/剪映 字样的文件夹，探它下面的 User Data\Cache\music / Cache\music
// 要手动加自己的文件夹：在 discoverMusicDirs() 末尾 found.push("你的路径") 即可。
let _discAt = 0, _discDirs = null;
// 素材包结构识别：文件夹若是「整理导出」的素材包（下面有 音乐/音效/环境底噪 子目录），
// 返回真正要扫描的子目录及各自类型；普通文件夹返回它本身。注册/自动发现都走这一个入口，
// 用户只需要选一次素材包根目录，音效/底噪的类型就全对。
function expandAudioDirs(dir, defaultKind) {
  const out = [];
  let names;
  try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  const KIND_BY_NAME = { "音乐": "music", "音效": "sfx", "环境底噪": "ambient", "music": "music", "sfx": "sfx", "ambient": "ambient" };
  let expanded = false;
  for (const de of names) {
    const k = KIND_BY_NAME[de.name];
    if (!k || !de.isDirectory()) continue;
    const full = path.join(dir, de.name);
    try { if (fs.statSync(full).isDirectory()) { out.push({ dir: full, kind: k }); expanded = true; } } catch (e) {}
  }
  if (!expanded) out.push({ dir, kind: defaultKind || "music" });
  return out;
}
// 本地固定盘列表（DriveType=3），进程内只查一次。网络映射盘/光驱的同步 IO
// 可能一卡几十秒，全盘浅扫必须绕开它们；查询失败时保守只扫 C:
let _fixedDrives = null;
function fixedDrives() {
  if (_fixedDrives) return _fixedDrives;
  try {
    const out = require("child_process").execSync(
      "powershell -NoProfile -Command \"(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3').DeviceID\"",
      { timeout: 8000, windowsHide: true }).toString();
    const ds = out.match(/[A-Z]:/g);
    if (ds && ds.length) { _fixedDrives = ds.map(d => d + "\\"); return _fixedDrives; }
  } catch (e) { /* 查询失败走兜底 */ }
  _fixedDrives = ["C:\\"];
  return _fixedDrives;
}
function discoverMusicDirs() {
  if (process.env.LAOYU_STUDIO_DISABLE_DISCOVERY === "1") return [];
  if (_discDirs && Date.now() - _discAt < 300000) return _discDirs;
  const found = [], seen = new Set();
  const addDir = d => {
    if (!d) return;
    try {
      if (fs.statSync(d).isDirectory()) {
        const key = path.resolve(d);
        if (!seen.has(key)) { seen.add(key); found.push(d); }
      }
    } catch (e) { /* 不存在就跳过 */ }
  };
  addDir(path.join(process.env.LOCALAPPDATA || "", "JianyingPro", "User Data", "Cache", "music"));
  addDir(path.join(TOOL_DIR, "剪映本地缓存"));
  const SKIP = /^(windows|program files.*|\$recycle\.bin|system volume information|perflogs|node_modules|appdata|intel|drivers)$/i;
  for (const root of fixedDrives()) { // 只扫本地固定盘，网络盘/光驱不碰
    try { fs.accessSync(root); } catch (e) { continue; }
    addDir(path.join(root, "JianyingPro", "User Data", "Cache", "music")); // 盘根直下的快路径
    let level = [root], visited = 0;
    for (let depth = 0; depth < 3 && level.length && visited < 3000; depth++) {
      const next = [];
      for (const d of level) {
        let names; try { names = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { continue; }
        // 素材包自动发现：浅扫途中遇到「整理导出」的包根（有 bgm_library.json），
        // 把它的 音乐/音效/环境底噪 子目录直接纳入扫描——桌面/下载里的包零配置可用
        if (names.some(de => de.name === "bgm_library.json")) {
          for (const p of expandAudioDirs(d, "music")) addDir(p.dir);
        }
        for (const de of names) {
          if (!de.isDirectory() || SKIP.test(de.name)) continue;
          if (++visited >= 3000) break;
          const full = path.join(d, de.name);
          if (/jianying|剪映/i.test(de.name)) {
            addDir(path.join(full, "User Data", "Cache", "music"));
            addDir(path.join(full, "Cache", "music"));
          }
          if (depth < 2) next.push(full);
        }
      }
      level = next;
    }
  }
  _discDirs = found; _discAt = Date.now();
  return found;
}

// Read the configured library through a bounded cache shared with audio requests.
let legacy, legacyAt = 0;
function legacyLibrary() {
  if (Date.now() - legacyAt >= 10000) {
    legacy = readLegacyLibrary(DATA_DIR);
    legacyAt = Date.now();
  }
  return legacy;
}
function musicDirectories(name) {
  const old = legacyLibrary();
  return [...new Set(discoverMusicDirs().concat(userMusicDirs(), old?.match(name) ? old.dirs : []))];
}

// 安全解析 /music/<name>：拒绝路径穿越，返回真实存在的文件路径（跨已发现目录找）
function resolveMusicPath(name) {
  if (!name || /[\\/]|\.\./.test(name)) return null;
  for (const dir of musicDirectories(name)) {
    const p = path.join(dir, name);
    try { if (fs.statSync(p).isFile()) return p; } catch (e) {}
  }
  return null;
}

/* ── 用户常驻目录：手动注册的音乐/音效文件夹（含共享同步盘）──────────
   存 user-dirs.json：[{dir, kind}]。服务重启自动重扫，浏览器端零授权，
   解决「超级导入/手动加的目录重启后文件全部丢失」的问题。 */
const USER_DIRS_FILE = path.join(DATA_DIR, "user-dirs.json");
function loadUserDirs() {
  try {
    const a = JSON.parse(fs.readFileSync(USER_DIRS_FILE, "utf8"));
    return Array.isArray(a)
      ? a.filter(x => x && x.dir)
        .map(x => ({ ...x, dir: path.resolve(TOOL_DIR, x.dir) })) // 相对路径按工具目录解析，手编配置也容错
      : [];
  } catch (e) { return []; }
}
function saveUserDirs(list) {
  try { fs.writeFileSync(USER_DIRS_FILE, JSON.stringify(list, null, 2), "utf8"); }
  catch (e) { console.error("user-dirs.json 写入失败：" + e.message); }
  _userDirsOk = null; _userDirsAt = 0; // 目录列表变了，两层缓存都立刻失效
  manifestAt = 0;
}
// 用户目录缓存 60 秒：网络盘 IO 慢，别每首探活都去 stat
let _userDirsAt = 0, _userDirsOk = null;
function userMusicDirs() {
  if (_userDirsOk && Date.now() - _userDirsAt < 60000) return _userDirsOk;
  const dirs = [];
  for (const u of loadUserDirs()) {
    try { if (fs.statSync(u.dir).isDirectory()) dirs.push(u.dir); }
    catch (e) { console.warn("用户目录暂不可访问（跳过）：" + u.dir); } // 网络盘没挂上等情况，静默跳过
  }
  _userDirsOk = dirs; _userDirsAt = Date.now();
  return dirs;
}

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
  ".jsonl": "application/json", ".md": "text/markdown; charset=utf-8",
  ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".wav": "audio/wav",
  ".png": "image/png", ".gif": "image/gif",
};

// manifest 内存缓存：10 秒内重复请求不重扫磁盘（剪映加新歌后最迟 10 秒可见）
let manifestCache = null, manifestAt = 0;

function sniffFmt(p, ext) {
  try {
    const fd = fs.openSync(p, "r");
    const buf = Buffer.alloc(12);
    fs.readSync(fd, buf, 0, 12, 0);
    fs.closeSync(fd);
    const s = buf.toString("latin1");
    if (s.slice(4, 8) === "ftyp") return "m4a";       // MP4/M4A 容器（剪映常把 .mp3 存成这个）
    if (s.slice(0, 3) === "ID3") return "mp3";
    if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return "mp3";
    if (s.startsWith("RIFF")) return "wav";
    if (s.startsWith("OggS")) return "ogg";
    if (s.startsWith("fLaC")) return "flac";
  } catch (e) { /* 读头失败按扩展名 */ }
  return ext;
}

/* ── 音频时长（秒）解析：给自动分类音乐/音效用 ──────────────────────
   m4a：moov/mvhd 里有精确 timescale+duration（moov 通常在文件头，读前 1MB 足够）
   mp3：按第一帧比特率 CBR 估算（分类用途，误差可接受）
   wav：字节率换算 */
const durCache = new Map(); // key: name|size|mtime -> seconds

function readAudioDuration(p, fmt, size, mtime) {
  const key = p + "|" + size + "|" + mtime;
  if (durCache.has(key)) return durCache.get(key);
  let sec = null;
  try {
    if (fmt === "m4a") {
      const fd = fs.openSync(p, "r");
      const buf = Buffer.alloc(Math.min(size, 1048576));
      fs.readSync(fd, buf, 0, buf.length, 0);
      fs.closeSync(fd);
      const idx = buf.indexOf("mvhd");
      if (idx >= 0 && idx + 24 < buf.length) {
        const version = buf[idx + 4];
        if (version === 1 && idx + 36 < buf.length) {
          // v1: version(1)flags(3)ctime(8)mtime(8)timescale(4)duration(8)
          const timescale = buf.readUInt32BE(idx + 24);
          const dur = Number(buf.readBigUInt64BE(idx + 28));
          if (timescale > 0) sec = dur / timescale;
        } else {
          // v0: version(1)flags(3)ctime(4)mtime(4)timescale(4)duration(4)
          const timescale = buf.readUInt32BE(idx + 16);
          const dur = buf.readUInt32BE(idx + 20);
          if (timescale > 0 && dur > 0) sec = dur / timescale;
        }
      }
    } else if (fmt === "mp3") {
      // ID3v2 头: 'ID3'+ver(2)+flags(1)+size(4 synchsafe) → 音频帧从 10+size 开始
      const fd = fs.openSync(p, "r");
      const head = Buffer.alloc(16);
      fs.readSync(fd, head, 0, 16, 0);
      let offset = 0;
      if (head.toString("latin1", 0, 3) === "ID3") {
        offset = 10 + ((head[6] & 0x7f) << 21) + ((head[7] & 0x7f) << 14) + ((head[8] & 0x7f) << 7) + (head[9] & 0x7f);
      }
      // 从 offset 向后扫帧同步 0xFF Ex/Fx（容忍 ID3 padding），最多 8KB
      const scan = Buffer.alloc(8192);
      fs.readSync(fd, scan, 0, scan.length, offset);
      fs.closeSync(fd);
      let frame = -1;
      for (let i = 0; i < scan.length - 4; i++) {
        if (scan[i] === 0xff && (scan[i + 1] & 0xe0) === 0xe0 && scan[i + 2] !== 0) { frame = i; break; }
      }
      if (frame >= 0) {
        const b1 = scan[frame + 1], b2 = scan[frame + 2];
        const verBits = (b1 >> 3) & 3; // 3=MPEG1, 2=MPEG2, 0=MPEG2.5
        const bitrateIdx = (b2 >> 4) & 0xf;
        const table = verBits === 3
          ? [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320,0]   // MPEG1 L3
          : [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160,0];      // MPEG2/2.5 L3
        const kbps = table[bitrateIdx];
        if (kbps > 0) sec = Math.max(1, Math.round((size - offset - frame) * 8 / (kbps * 1000)));
      }
    } else if (fmt === "wav") {
      const fd = fs.openSync(p, "r");
      const buf = Buffer.alloc(64);
      fs.readSync(fd, buf, 0, 64, 0);
      fs.closeSync(fd);
      if (buf.toString("latin1", 0, 4) === "RIFF") {
        const byteRate = buf.readUInt32LE(28); // fmt 块内 byteRate
        if (byteRate > 0) sec = Math.max(1, Math.round((size - 44) / byteRate));
      }
    }
  } catch (e) { /* 解析失败返回 null，入库后首播由前端补 */ }
  if (sec !== null) durCache.set(key, Math.round(sec * 10) / 10);
  return sec !== null ? Math.round(sec * 10) / 10 : null;
}

function buildManifest() {
  if (manifestCache && Date.now() - manifestAt < 10000) return manifestCache;
  const dirs = discoverMusicDirs();
  const draftMeta = scanDraftMeta().byHash; // 哈希 → {title 原名, author 作者, vip, mid 曲目ID, type}
  const userDirs = loadUserDirs(); // {dir, kind}：手动注册的常驻目录，kind 视为用户确认过
  const userPaths = new Set(userDirs.map(u => u.dir));
  const kindByDir = new Map(userDirs.map(u => [u.dir, u.kind || "music"]));
  // 素材包子目录名自带类型（自动发现/注册展开出来的 音乐/音效/环境底噪），视为导出时确认过的分类
  const PKG_KIND = { "音乐": "music", "音效": "sfx", "环境底噪": "ambient", "music": "music", "sfx": "sfx", "ambient": "ambient" };
  const old = legacyLibrary();
  const ordinary = new Set(dirs.concat(userMusicDirs()));
  const allDirs = [...new Set([...ordinary, ...(old?.dirs || [])])];
  const seen = new Map(); // 主文件名（去扩展名）-> {name, fmt, size, url, dir}
  const counts = allDirs.map(() => 0);
  allDirs.forEach((dir, di) => {
    let files;
    try { files = fs.readdirSync(dir); } catch (e) { return; }
    const isUser = userPaths.has(dir);
    for (const f of files) {
      const m = /\.(mp3|m4a|wav|ogg|flac)$/i.exec(f);
      if (!m) continue;
      const legacyId = old?.match(f);
      if (!ordinary.has(dir) && !legacyId) continue;
      const base = f.replace(/\.[^.]+$/, "");
      if (seen.has(base)) continue; // 两目录同名（副本即缓存拷贝）只留一份
      const p = path.join(dir, f);
      try {
        const st = fs.statSync(p);
        if (!st.isFile()) continue;
        counts[di]++;
        const fmt = sniffFmt(p, m[1].toLowerCase());
        const pkgKind = PKG_KIND[path.basename(dir)]; // 素材包子目录（音乐/音效/环境底噪）名即类型
        // 草稿元数据：原名/作者/VIP（能认出来多少取决于剪映草稿留了多少明文）
        const dm = draftMeta[base];
        const meta = dm && (dm.title || dm.author) ? {
          title: dm.title || undefined,
          author: dm.author || undefined,
          vip: dm.vip === "1" || undefined,
          mid: dm.mid || undefined,
        } : undefined;
        seen.set(base, {
          name: f,
          legacyId,
          fmt,
          size: st.size,
          duration: readAudioDuration(p, fmt, st.size, st.mtimeMs), // 秒；供前端自动分类音乐/音效
          kind: kindByDir.get(dir) || pkgKind || "music",
          kindManual: isUser || pkgKind ? true : undefined, // 注册目录/素材包分类视为确认过，前端不再按时长改判
          meta,
          url: "/music/" + encodeURIComponent(f),
          dir: di, // 来自哪个目录（前端多位置选择用）
        });
      } catch (e) { /* 文件被剪映删了一半之类，跳过 */ }
    }
  });
  manifestCache = JSON.stringify({
    cacheDirs: allDirs.map((d, i) => ({
      dir: d, count: counts[i],
      user: userPaths.has(d) || undefined,      // 手动注册的目录：前端选择框里带「移除注册」入口
      kind: kindByDir.get(d) || undefined,
    })),
    files: [...seen.values()],
    legacy: old?.summary,
  });
  manifestAt = Date.now();
  return manifestCache;
}

/* ── 剪映草稿元数据：把缓存里的哈希乱码还原成「原名 · 作者 · VIP」 ──────
   明文源（草稿正文新版加密，这三处是仅存的明文）：
     1) Timelines 各分段下的 template.json.bak，其 materials.audios[]：
        path（哈希文件名）↔ name（原名）↔ effect_id（曲目ID）↔ type
     2) key_value.json：materialId（曲目ID）→ is_vip / 分类 / 搜索词
     3) materials/audio/ 素材池（哈希命名，无名字，只是佐证文件在）
   产物落 draft-meta.json（含作者缓存），5 分钟重扫；作者用曲目ID问抖音音乐页，
   慢慢补（每轮最多查 3 首防限流），查不到留空。 */
const DRAFT_META_FILE = path.join(DATA_DIR, "draft-meta.json");
let _draftMeta = null, _draftMetaAt = 0;
const HEX32RE = /^[0-9a-f]{32}$/i;

function loadDraftMeta() {
  if (_draftMeta) return _draftMeta;
  try { _draftMeta = JSON.parse(fs.readFileSync(DRAFT_META_FILE, "utf8")); } catch (e) {}
  if (!_draftMeta || typeof _draftMeta !== "object") _draftMeta = { scanned_at: 0, byHash: {}, byMid: {} };
  if (!_draftMeta.byHash) _draftMeta.byHash = {};
  if (!_draftMeta.byMid) _draftMeta.byMid = {};
  return _draftMeta;
}
function saveDraftMeta() {
  try { fs.writeFileSync(DRAFT_META_FILE, JSON.stringify(_draftMeta), "utf8"); } catch (e) {}
}
function readJsonIfPlain(p) {
  try {
    const fd = fs.openSync(p, "r");
    const buf = Buffer.alloc(1);
    fs.readSync(fd, buf, 0, 1, 0);
    fs.closeSync(fd);
    if (buf[0] !== 0x7b && buf[0] !== 0x5b) return null; // 加密草稿不是 { 开头
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) { return null; }
}
function scanDraftMeta() {
  if (process.env.LAOYU_STUDIO_DISABLE_DISCOVERY === "1") return { byHash:{} };
  const meta = loadDraftMeta();
  if (Date.now() - _draftMetaAt < 300000) return meta; // 5 分钟重扫
  _draftMetaAt = Date.now();
  const base = path.join(process.env.LOCALAPPDATA || "", "JianyingPro", "User Data", "Projects");
  let roots = [];
  try { roots = fs.readdirSync(base).filter(n => /^com\.lveditor\.(cloud\.)?draft/.test(n)).map(n => path.join(base, n)); } catch (e) {}
  const byHash = {}, byMid = {};
  for (const root of roots) {
    let drafts = [];
    try { drafts = fs.readdirSync(root).filter(n => !n.startsWith(".")).map(n => path.join(root, n)); } catch (e) { continue; }
    for (const ddir of drafts) {
      // 1) 时间轴明文快照：哈希 ↔ 原名 ↔ 曲目ID ↔ 类型
      const tjPaths = [];
      try { for (const seg of fs.readdirSync(path.join(ddir, "Timelines"))) tjPaths.push(path.join(ddir, "Timelines", seg, "template.json.bak")); } catch (e) {}
      tjPaths.push(path.join(ddir, "draft_content.json"));
      for (const tj of tjPaths) {
        const d = readJsonIfPlain(tj);
        if (!d) continue;
        for (const a of (d.materials && d.materials.audios) || []) {
          const m = /([0-9a-f]{32})\.(?:mp3|m4a|wav)$/i.exec((a.path || "").replace(/\\/g, "/"));
          if (!m || /\/video\//i.test(a.path || "")) continue;
          const h = m[1].toLowerCase();
          const mid = String(a.effect_id || a.resource_id || "");
          const cur = byHash[h] || (byHash[h] = { title: "", mid: "", type: "", vip: "", drafts: [] });
          if (!cur.title && a.name) cur.title = String(a.name).slice(0, 80);
          if (!cur.mid && mid) cur.mid = mid;
          if (!cur.type && a.type) cur.type = a.type === "music" ? "music" : a.type === "sound" ? "sound_effect" : String(a.type).slice(0, 20);
          if (cur.drafts.length < 3 && !cur.drafts.includes(path.basename(ddir))) cur.drafts.push(path.basename(ddir));
          if (mid && !byMid[mid]) byMid[mid] = { title: cur.title || "", vip: "", kw: "" };
        }
      }
      // 2) key_value.json：曲目ID → VIP / 分类 / 搜索词（比时间轴更全，但没哈希）
      const kv = readJsonIfPlain(path.join(ddir, "key_value.json"));
      if (kv) {
        for (const v of Object.values(kv)) {
          if (!v || typeof v !== "object" || v.materialCategory !== "audio" || !v.materialId) continue;
          const mid = String(v.materialId);
          const cur = byMid[mid] || (byMid[mid] = { title: "", vip: "", kw: "" });
          if (!cur.title && v.materialName) cur.title = String(v.materialName).slice(0, 80);
          if (v.is_vip !== undefined) cur.vip = String(v.is_vip) === "1" ? "1" : "0";
          if (!cur.kw && v.searchKeyword) cur.kw = String(v.searchKeyword).slice(0, 40);
        }
      }
    }
  }
  // 交叉补全：哈希侧缺的 vip/title 用曲目ID侧补；保留上一轮已查到的 author
  const oldByHash = meta.byHash || {};
  for (const [h, cur] of Object.entries(byHash)) {
    const m = cur.mid ? byMid[cur.mid] : null;
    if (m) {
      if (!cur.title && m.title) cur.title = m.title;
      if (m.vip) cur.vip = m.vip;
      cur.kw = m.kw || "";
    }
    const old = oldByHash[h];
    cur.author = (old && old.author) || ""; // 作者缓存不丢
    cur.author_tried = (old && old.author_tried) || false;
  }
  meta.byHash = byHash;
  meta.byMid = byMid;
  meta.scanned_at = Date.now();
  _draftMeta = meta;
  saveDraftMeta();
  const n = Object.keys(byHash).length;
  if (n) console.log(`草稿元数据：认出 ${n} 首的原名（明文快照覆盖有限，剪映新版草稿正文加密）`);
  return meta;
}

/* 作者慢查询：每轮最多 3 首、每首 8 秒超时，结果进缓存不再查 */
async function authorLookupLoop() {
  for (;;) {
    await new Promise(r => setTimeout(r, 15000));
    try {
      const meta = scanDraftMeta();
      const todo = Object.entries(meta.byHash)
        .filter(([h, v]) => v.mid && !v.author && !v.author_tried)
        .slice(0, 3);
      for (const [h, v] of todo) {
        try {
          const r = await fetch("https://www.douyin.com/music/" + v.mid, {
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" },
            signal: AbortSignal.timeout(8000),
          });
          const html = await r.text();
          let m = /\\?"musicDetail\\":\{.*?\\?"author\\?":\\?"([^"\\]{1,60})/.exec(html);
          if (!m) m = /\\?"author\\?":\\?"([^"\\]{1,60})/.exec(html);
          v.author = m ? m[1].trim() : "";
          if (v.author) console.log(`作者查到：${v.title || h.slice(0, 8)} ← ${v.author}`);
        } catch (e) { v.author = ""; }
        v.author_tried = true;
        await new Promise(r => setTimeout(r, 2000));
      }
      if (todo.length) { saveDraftMeta(); manifestAt = 0; } // 让 manifest 带上新作者
    } catch (e) { /* 循环永不退出 */ }
  }
}

/* ── 用户常驻目录管理：弹 Windows 原生选框拿绝对路径，注册进 user-dirs.json ──
   为什么不走浏览器选目录：浏览器拿不到绝对路径、File 对象重启即失；
   注册到服务端后重启自动重扫，浏览器端零操作。 */
async function readJsonBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
  catch (e) { return {}; }
}
function pickFolderDialog() {
  // STA + UTF-8 输出：FolderBrowserDialog 必须 STA；中文路径必须强制 UTF-8 否则 GBK 乱码。
  // 属主窗口：一个 0x0、置顶、屏幕居中的隐形 Form——没有它，从后台进程弹的对话框可能
  // 渲染在用户看不见的地方。SelectedPath：记上次选过的目录，打开直接停在老地方，不再从头找。
  return new Promise(resolve => {
    const last = readPickerLast();
    const esc = s => s.replace(/'/g, "''"); // PowerShell 单引号串转义
    const { execFile } = require("child_process");
    execFile("powershell", ["-NoProfile", "-STA", "-Command",
      "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; " +
      "Add-Type -AssemblyName System.Windows.Forms | Out-Null; " +
      "$owner = New-Object System.Windows.Forms.Form; " +
      "$owner.TopMost = $true; $owner.Size = '0,0'; " +
      "$owner.StartPosition = 'CenterScreen'; $owner.ShowInTaskbar = $false; " +
      "$f = New-Object System.Windows.Forms.FolderBrowserDialog; " +
      (last ? "$f.SelectedPath = '" + esc(last) + "'; " : "") +
      "$f.Description = '选择音乐/音效文件夹（工具会记住它，重启自动恢复）'; " +
      "$f.ShowNewFolderButton = $false; " +
      "if ($f.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $f.SelectedPath }; " +
      "$owner.Dispose()"],
      { timeout: 300000, windowsHide: true, encoding: "utf8" },   // windowsHide:true：隐藏的是控制台宿主，对话框本体挂在置顶属主上照常弹出
      (err, stdout) => {
        if (err || !stdout) return resolve(null);
        const p = String(stdout).trim();
        if (p) { try { fs.writeFileSync(PICKER_LAST_FILE, p, "utf8"); } catch (e) {} } // 记住这次的位置
        resolve(p || null);
      });
  });
}
/* ── 超级导入后自动记住文件夹：零操作定位 ──────────────────────────
   浏览器选框不给绝对路径（安全限制），但素材包文件名带哈希后缀、全盘唯一。
   页面把「包根目录名 + 若干文件名指纹」POST 过来，服务器定向定位：
   阶段A 常见位置直探（秒回）；阶段B 限时全盘宽搜（目录名匹配剪枝）。
   找到直接注册进 user-dirs.json——用户从头到尾不用再选第二次。 */
const PICKER_LAST_FILE = path.join(DATA_DIR, "picker-last.txt");
function readPickerLast() {
  try { const s = fs.readFileSync(PICKER_LAST_FILE, "utf8").trim(); return s || null; } catch (e) { return null; }
}
function probeHit(dir, probes) {
  // 素材包的音频躺在包根的一级子目录（音乐/音效/底噪）里，探针要连同子目录一起找
  const tryDirs = [dir];
  try {
    for (const de of fs.readdirSync(dir, { withFileTypes: true })) {
      if (de.isDirectory()) tryDirs.push(path.join(dir, de.name));
    }
  } catch (e) {}
  let n = 0;
  for (const p of probes) {
    for (const d of tryDirs) { try { fs.statSync(path.join(d, p)); n++; break; } catch (e) {} }
  }
  return n >= Math.min(3, probes.length) && n >= Math.ceil(probes.length * 0.6);
}
async function handleFindDir(req, res) {
  const reply = obj => res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify(obj));
  try {
    const body = await readJsonBody(req);
    const folderName = String(body.folderName || "").trim();
    const probes = (Array.isArray(body.probes) ? body.probes : [])
      .map(x => String(x)).filter(x => x && !/[\\/]/.test(x) && x.length < 120).slice(0, 8);
    if (probes.length < 2) { reply({ ok: false, reason: "no_probes" }); return; }

    // 阶段A：用户常见位置 + 各盘根 + 工具目录旁，直探（含拼 folderName 子层）
    const home = process.env.USERPROFILE || "";
    const candidates = [
      home && path.join(home, "Desktop"), home && path.join(home, "Downloads"),
      home && path.join(home, "Documents"), home && path.join(home, "Music"),
      home && path.join(home, "Pictures"), home && path.join(home, "Videos"),
      TOOL_DIR, path.dirname(TOOL_DIR), path.join(TOOL_DIR, "剪映本地缓存"),
      ...fixedDrives(),
    ].filter(Boolean);
    const seen = new Set();
    for (const c of candidates) {
      for (const d of [c, folderName ? path.join(c, folderName) : null]) {
        if (!d || seen.has(d)) continue;
        seen.add(d);
        try { if (fs.statSync(d).isDirectory() && probeHit(d, probes)) return found(d, reply); } catch (e) {}
      }
    }

    // 阶段B：限时 DFS 全盘深挖（用户共享盘路径动辄七八层，BFS 扫不深）。
    // 深度≤12、预算 30000 目录、12 秒；系统目录照旧跳过。
    const deadline = Date.now() + 12000;
    const SKIP = /^(windows|program files.*|\$recycle\.bin|system volume information|perflogs|node_modules|\.git|intel|drivers|appdata|winxsx?|installer|packages|temp|cache[0-9]?)$/i;
    const want = folderName.toLowerCase();
    let visited = 0, hit = null;
    const dfs = d => {
      if (hit || visited > 30000 || Date.now() > deadline) return;
      let names; try { names = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
      for (const de of names) {
        if (hit || visited > 30000 || Date.now() > deadline) return;
        if (!de.isDirectory() || SKIP.test(de.name)) continue;
        visited++;
        const full = path.join(d, de.name);
        if (want && de.name.toLowerCase() === want) {
          try { if (fs.statSync(full).isDirectory() && probeHit(full, probes)) { hit = full; return; } } catch (e) {}
        }
        dfs(full);
      }
    };
    for (const root of fixedDrives()) { dfs(root); if (hit) break; }
    if (hit) return found(hit, reply);
    reply({ ok: false, reason: "not_found", visited });
  } catch (e) {
    reply({ ok: false, reason: "error:" + String(e.message || e).slice(0, 120) });
  }

  function found(hit, reply) {
    const targets = expandAudioDirs(hit, "music");
    const list = loadUserDirs();
    let fresh = 0;
    for (const t of targets) {
      if (list.some(u => u.dir.toLowerCase() === t.dir.toLowerCase())) continue;
      list.push({ dir: t.dir, kind: t.kind, added_at: new Date().toISOString() });
      fresh++;
    }
    if (fresh) saveUserDirs(list);
    let count = 0;
    for (const t of targets) {
      try { count += fs.readdirSync(t.dir).filter(f => /\.(mp3|m4a|wav|ogg|flac)$/i.test(f)).length; } catch (e) {}
    }
    console.log("超级导入自动记住：" + hit + "（音频 " + count + " 首" + (fresh ? "" : "，此前已注册") + "）");
    reply({ ok: true, dir: hit, registered: fresh, count });
  }
}

async function handleAddDir(req, res) {
  const reply = obj => res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify(obj));
  try {
    const body = await readJsonBody(req);
    const kind = body.kind === "sfx" ? "sfx" : "music";
    const dir = await pickFolderDialog();
    if (!dir) { reply({ ok: false, cancelled: true }); return; }
    let st;
    try { st = fs.statSync(dir); } catch (e) { st = null; }
    if (!st || !st.isDirectory()) { reply({ ok: false, error: "选的文件夹访问不到：" + dir }); return; }
    // 素材包展开：选中的若是「整理导出」的包根（下面有 音乐/音效/环境底噪 子目录），
    // 一次把子目录全记住、类型各归各——用户不用挨个加三次
    const targets = expandAudioDirs(dir, kind);
    const list = loadUserDirs();
    let fresh = 0, count = 0;
    for (const t of targets) {
      if (list.some(u => u.dir.toLowerCase() === t.dir.toLowerCase())) continue;
      list.push({ dir: t.dir, kind: t.kind, added_at: new Date().toISOString() });
      fresh++;
    }
    for (const t of targets) {
      try { count += fs.readdirSync(t.dir).filter(f => /\.(mp3|m4a|wav|ogg|flac)$/i.test(f)).length; }
      catch (e) { /* 空目录或暂时读不了都允许注册 */ }
    }
    if (fresh) saveUserDirs(list);
    console.log((fresh ? "已记住" : "已确认记住（此前已注册）") + "文件夹（重启自动恢复）："
      + targets.map(t => (t.kind === "sfx" ? "音效" : t.kind === "ambient" ? "底噪" : "音乐") + "←" + t.dir).join("；")
      + "（音频 " + count + " 首" + (fresh ? "" : "，本次无新增注册") + "）");
    reply({ ok: true, dir, kind, count, registered: fresh, total: targets.length });
  } catch (e) {
    reply({ ok: false, error: String(e.message || e).slice(0, 200) });
  }
}
async function handleRemoveDir(req, res) {
  const reply = obj => res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify(obj));
  try {
    const body = await readJsonBody(req);
    const dir = path.resolve(TOOL_DIR, String(body.dir || "")); // 统一成绝对路径再比（正反斜杠/相对写法都认）
    const list = loadUserDirs();
    const next = list.filter(u => path.resolve(TOOL_DIR, u.dir) !== dir);
    if (next.length === list.length) { reply({ ok: false, error: "没找到这个注册目录" }); return; }
    saveUserDirs(next);
    console.log("已取消记住文件夹：" + dir);
    reply({ ok: true });
  } catch (e) {
    reply({ ok: false, error: String(e.message || e).slice(0, 200) });
  }
}

function saveDatabase(input) {
  const result=saveLegacyDatabase(DATA_DIR,input);
  legacyAt=0;
  manifestAt=0;
  return result;
}

module.exports = function handleTagger(req, res, pathname) {
  try {
    let filePath = null;
    if (pathname === "/tagger/" || pathname === "/tagger/index.html") {
      filePath = path.join(TOOL_DIR, "index.html");
    } else if (pathname === "/tagger/legacy-library.js") {
      filePath = path.join(TOOL_DIR, "legacy-library.js");
    } else if (/^\/tagger\/assets\/stickers\/[a-z]+\.png$/.test(pathname)) {
      filePath = path.join(TOOL_DIR, pathname.slice("/tagger/".length));
    } else if (pathname === "/manifest.json") {
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(buildManifest());
      return;
    } else if (pathname === "/add-dir") {
      if (req.method !== "POST") { res.writeHead(405); res.end(); return; }
      handleAddDir(req, res);
      return;
    } else if (pathname === "/find-dir") {
      if (req.method !== "POST") { res.writeHead(405); res.end(); return; }
      handleFindDir(req, res);
      return;
    } else if (pathname === "/remove-dir") {
      if (req.method !== "POST") { res.writeHead(405); res.end(); return; }
      handleRemoveDir(req, res);
      return;
    } else if (pathname.startsWith("/music/")) {
      // HEAD：前端「数据清理」用它探活（文件还在不在），只回头不带体
      if (req.method === "HEAD") {
        const p = resolveMusicPath(pathname.slice(7));
        if (!p) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { "Content-Length": fs.statSync(p).size });
        res.end(); return;
      }
      filePath = resolveMusicPath(pathname.slice(7));
    }
    // 404 保险：文件必须真实存在，且落在工具目录或某个音频目录（剪映缓存/用户注册目录）内
    // ——只认 TOOL_DIR 或路径含 "music" 会挡住用户注册的共享文件夹，必须按目录白名单判
    if (!filePath || !fs.existsSync(filePath) ||
        !filePath.startsWith(TOOL_DIR) && !musicDirectories(path.basename(filePath)).some(d => filePath.startsWith(d + path.sep) || filePath === d)) {
      res.writeHead(404); res.end("not found"); return;
    }
    const stat = fs.statSync(filePath);
    const contentType = MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    // Range 支持：浏览器拖进度条 seek 必须靠 206 分段请求，否则会跳回 0 秒
    const range = req.headers.range;
    const rangeMatch = range && /^bytes=(\d*)-(\d*)$/.exec(range);
    if (rangeMatch) {
      let start = rangeMatch[1] ? parseInt(rangeMatch[1], 10) : 0;
      let end = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : stat.size - 1;
      if (isNaN(start) || start < 0) start = 0;
      if (isNaN(end) || end >= stat.size) end = stat.size - 1;
      if (start > end || start >= stat.size) {
        res.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
        res.end();
        return;
      }
      res.writeHead(206, {
        "Content-Type": contentType,
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Content-Length": end - start + 1,
        "Accept-Ranges": "bytes",
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { "Content-Type": contentType, "Accept-Ranges": "bytes", "Content-Length": stat.size });
    fs.createReadStream(filePath).pipe(res);
  } catch (e) {
    res.writeHead(500); res.end(e.message);
  }
};

module.exports.saveDatabase = saveDatabase;
