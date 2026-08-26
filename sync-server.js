// 捞鱼打标工具 · 同步服务器
// 作用：动态扫描剪映音乐缓存目录（+本地副本目录），生成增量清单，
//       让打标工具自动带出剪映新缓存——不用手动选文件夹。
// 启动：双击「启动打标工具.bat」，或命令行 node sync-server.js
const http = require("http");
const fs = require("fs");
const path = require("path");

const TOOL_DIR = __dirname;
const PORT = 8431;

// 扫描目录：自动发现，不再写死。三路探测（结果缓存 5 分钟）：
//   1) 默认位置：%LOCALAPPDATA%\JianyingPro\User Data\Cache\music
//   2) 工具目录旁的「剪映本地缓存」（手动整理的副本，老行为保留）
//   3) 全盘浅扫（深度≤3、每盘≤3000 目录）：剪映里改过缓存位置的话，
//      自选目录下会有 JianyingPro/剪映 字样的文件夹，探它下面的 User Data\Cache\music / Cache\music
// 要手动加自己的文件夹：在 discoverMusicDirs() 末尾 found.push("你的路径") 即可。
let _discAt = 0, _discDirs = null;
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

// 安全解析 /music/<name>：拒绝路径穿越，返回真实存在的文件路径（跨已发现目录找）
function resolveMusicPath(name) {
  if (!name || /[\\/]|\.\./.test(name)) return null;
  for (const dir of discoverMusicDirs()) {
    const p = path.join(dir, name);
    try { if (fs.statSync(p).isFile()) return p; } catch (e) {}
  }
  return null;
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
  const seen = new Map(); // 主文件名（去扩展名）-> {name, fmt, size, url, dir}
  const counts = dirs.map(() => 0);
  dirs.forEach((dir, di) => {
    let files;
    try { files = fs.readdirSync(dir); } catch (e) { return; }
    for (const f of files) {
      const m = /\.(mp3|m4a|wav|ogg|flac)$/i.exec(f);
      if (!m) continue;
      const base = f.replace(/\.[^.]+$/, "");
      if (seen.has(base)) continue; // 两目录同名（副本即缓存拷贝）只留一份
      const p = path.join(dir, f);
      try {
        const st = fs.statSync(p);
        counts[di]++;
        const fmt = sniffFmt(p, m[1].toLowerCase());
        seen.set(base, {
          name: f,
          fmt,
          size: st.size,
          duration: readAudioDuration(p, fmt, st.size, st.mtimeMs), // 秒；供前端自动分类音乐/音效
          kind: "music",
          url: "/music/" + encodeURIComponent(f),
          dir: di, // 来自哪个缓存目录（前端多位置选择用）
        });
      } catch (e) { /* 文件被剪映删了一半之类，跳过 */ }
    }
  });
  manifestCache = JSON.stringify({
    cacheDirs: dirs.map((d, i) => ({ dir: d, count: counts[i] })), // 各缓存位置及音频数（前端选择框用）
    files: [...seen.values()],
  });
  manifestAt = Date.now();
  return manifestCache;
}

/* ── 反馈区：把同事在工具里写的问题一键转发到企微群机器人 ──────────────
   webhook 从哪拿：反馈群 → 群设置 → 添加群机器人 → 复制 Webhook 地址
   三种配置方式（优先级从高到低）：
     1. 环境变量 LAOYU_FEEDBACK_WEBHOOK（临时测试用）
     2. 工具目录下 feedback-webhook.txt（一行 URL，不改编码就能换）
     3. 下面的常量（随版本发布，同事开箱即用；注意仓库是公开的，
        建议用专门的反馈群，被陌生人滥用最多就是群里多几条消息，随时可换 key） */
const FEEDBACK_WEBHOOK = "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=1d51b768-913e-4374-93c5-d0f57d025241";
function feedbackWebhook() {
  if (process.env.LAOYU_FEEDBACK_WEBHOOK) return process.env.LAOYU_FEEDBACK_WEBHOOK.trim();
  try {
    const f = path.join(TOOL_DIR, "feedback-webhook.txt");
    if (fs.existsSync(f)) {
      const u = fs.readFileSync(f, "utf8").trim();
      if (u) return u;
    }
  } catch (e) {}
  return FEEDBACK_WEBHOOK.trim();
}
let _lastFeedbackAt = 0; // 同实例至少间隔 10 秒一条，防手滑连点刷屏
async function handleFeedback(req, res) {
  const reply = obj => res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify(obj));
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    const text = String(body.text || "").trim().slice(0, 3500);
    const contact = String(body.contact || "").trim().slice(0, 100);
    const version = String(body.version || "").trim().slice(0, 30);
    if (!text) { reply({ ok: false, error: "反馈内容是空的" }); return; }
    const hook = feedbackWebhook();
    if (!hook) { reply({ ok: false, unconfigured: true, error: "反馈机器人还没配置" }); return; }
    if (Date.now() - _lastFeedbackAt < 10000) { reply({ ok: false, error: "发得太快啦，歇 10 秒再发～" }); return; }
    const content = [
      "🐟 捞鱼打标工具 · 新反馈",
      "────────────",
      text,
      "",
      "👤 联系方式：" + (contact || "没留"),
      version ? "🏷 工具版本：v" + version : "",
      "🕐 " + new Date().toLocaleString("zh-CN", { hour12: false })
    ].filter(Boolean).join("\n");
    const r = await fetch(hook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ msgtype: "text", text: { content: content.slice(0, 4000) } }) // 企微 text 上限 4096 字节
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.errcode !== 0) { reply({ ok: false, error: "机器人接口返回异常(" + r.status + " " + (j.errmsg || "") + ")" }); return; }
    _lastFeedbackAt = Date.now();
    console.log("收到一条工具反馈（已转发到企微群）");
    reply({ ok: true });
  } catch (e) {
    reply({ ok: false, error: String(e.message || e).slice(0, 200) });
  }
}

/* ── 一键更新：下载发布 zip → 解压 → 覆盖工具文件（保留用户数据） ─────────
   用 PowerShell 干活（Windows 自带）；zip 下载先走原站，失败换 gh-proxy 镜像。 */
async function handleSelfUpdate(req, res) {
  const reply = obj => res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify(obj));
  try {
    const r = await fetch("https://lyzbcy.github.io/laoyu-tagger/version.json", { cache: "no-store" });
    const v = await r.json();
    if (!v.version || !v.zip) throw new Error("version.json 缺少字段");
    const os = require("os");
    const fsx = fs;
    const tmp = path.join(os.tmpdir(), "laoyu-update-" + Date.now());
    fsx.mkdirSync(tmp, { recursive: true });
    const ps1 = path.join(tmp, "update.ps1");
    const ps = `
$ErrorActionPreference='Stop'
$tmp = '${tmp.replace(/\\/g, "\\")}'
$dst = '${TOOL_DIR.replace(/\\/g, "\\")}'
$zip = Join-Path $tmp 'update.zip'
$ok = $false
foreach ($u in @('${v.zip}', 'https://gh-proxy.com/${v.zip}')) {
  try { Invoke-WebRequest -Uri $u -OutFile $zip -UseBasicParsing; $ok = $true; break } catch { }
}
if (-not $ok) { throw 'zip download failed' }
Expand-Archive -Path $zip -DestinationPath $tmp -Force
$src = Get-ChildItem $tmp -Directory | Where-Object { $_.Name -like 'laoyu-tagger-*' } | Select-Object -First 1
# 兼容两种仓库布局：旧版工具在 app/ 子目录，新版直接在仓库根
$srcDir = Join-Path $src.FullName 'app'
if (-not (Test-Path $srcDir)) { $srcDir = $src.FullName }
Get-ChildItem $srcDir | Where-Object { $_.Name -ne 'bgm_library.jsonl' -and $_.Name -ne 'docs' } | ForEach-Object {
  Copy-Item $_.FullName -Destination $dst -Recurse -Force
}
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
Write-Output 'LAOYU_UPDATE_OK'
`.trim();
    fsx.writeFileSync(ps1, ps, "utf8");
    const { execFile } = require("child_process");
    execFile("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1],
      { timeout: 180000, windowsHide: true }, (err, stdout) => {
        try { fsx.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
        if (err || !String(stdout).includes("LAOYU_UPDATE_OK")) {
          reply({ ok: false, error: (err ? err.message : stdout || "更新脚本异常").slice(0, 200) });
        } else {
          console.log("已一键更新到 v" + v.version + "，服务器 3 秒后自动重启加载新代码…");
          reply({ ok: true, version: v.version, restart: true });
          // 自我重启：脱离的子进程等旧进程退出后重新拉起服务器（新代码从磁盘加载）。
          // 新窗口照常自动打开工具页，老黑窗口会自然关闭。
          const { spawn } = require("child_process");
          const relaunch = spawn("cmd.exe",
            ["/c", `timeout /t 3 >nul & cd /d "${TOOL_DIR}" & node sync-server.js`],
            { detached: true, stdio: "ignore", windowsHide: false });
          relaunch.unref();
          setTimeout(() => process.exit(0), 800);
        }
      });
  } catch (e) {
    reply({ ok: false, error: e.message.slice(0, 200) });
  }
}

const server = http.createServer((req, res) => {  try {
    const pathname = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let filePath = null;
    if (pathname === "/" || pathname === "/index.html") {
      filePath = path.join(TOOL_DIR, "index.html");
    } else if (pathname.startsWith("/assets/")) {
      filePath = path.join(TOOL_DIR, pathname); // assets/stickers/xxx.png
    } else if (pathname === "/manifest.json") {
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(buildManifest());
      return;
    } else if (pathname === "/self-update") {
      handleSelfUpdate(req, res);
      return;
    } else if (pathname === "/feedback") {
      if (req.method !== "POST") { res.writeHead(405); res.end(); return; }
      handleFeedback(req, res);
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
    if (!filePath || !fs.existsSync(filePath) || !filePath.startsWith(TOOL_DIR) && !filePath.includes("music")) {
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
});

server.on("error", err => {
  if (err.code === "EADDRINUSE") {
    console.log("端口 " + PORT + " 已被占用——工具多半已经在运行了，这就帮你把工具页面打开。");
    try { require("child_process").exec(`start "" "http://127.0.0.1:${PORT}/?server=http://127.0.0.1:${PORT}"`); } catch (e) {}
    setTimeout(() => process.exit(2), 1200); // 退出码 2 = 已在运行，bat 据此提示
    return;
  }
  console.error(err);
  process.exit(1);
});

server.listen(PORT, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${PORT}/?server=http://127.0.0.1:${PORT}`;
  console.log("捞鱼打标工具已启动：" + url);
  console.log("监控目录（自动发现，含剪映自定义缓存位置，5 分钟重扫一次）：");
  discoverMusicDirs().forEach(d => console.log("  - " + d));
  console.log("剪映里新缓存的音乐，最迟 10 秒后自动出现在工具里（页面开着每分钟自动同步，重开页面立即同步）。");
  console.log("关掉这个黑窗口 = 关闭工具服务器。");
  // 自动打开浏览器
  const { exec } = require("child_process");
  exec(`start "" "${url}"`);
});
