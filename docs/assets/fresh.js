/*!
 * 捞鱼自用静态网页组件 · 强制刷新 & 更新日志（零依赖，自注入）
 * ---------------------------------------------------------------
 * 背景：静态网页（GitHub Pages / help.wshoto）都有缓存，发版后用户看到的
 *       可能还是旧 HTML。思路：HTML 里写死一个「页面内容版本号」，远端
 *       version.json 里写一个同含义的 site 号，打开页面时比对——
 *       不一致 => 浏览器里是旧缓存 => 强制刷新一次。
 *
 * 防死循环：同一会话内，每个远端 site 号只「自动」刷新一次（sessionStorage
 *       打标记）。刷新后若仍不一致（CDN 边缘还没生效），绝不再自动刷，
 *       只把「一键刷新」按钮亮给用户手动兜底。
 *
 * 用法：页面 <head> 里两行——
 *   <script>window.FRESH = { siteVersion: 1 };</script>
 *   <script src="assets/fresh.js" defer></script>
 *
 * 发版：改了页面内容就同步改两处——HTML 里的 siteVersion 和 version.json
 *       里的 "site"（各自 +1），工具版本号（version 字段）不受影响。
 */
(function () {
  "use strict";

  var cfg = window.FRESH || {};
  var pageVer = cfg.siteVersion;           // 本次部署打进 HTML 的页面内容版本
  var jsonPath = cfg.json || "version.json";

  /* ---------- 工具函数 ---------- */

  function ssGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function fmtDate(s) {
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(s || ""));
    return m ? +m[2] + "月" + +m[3] + "日" : s;
  }

  // 在当前地址上换一个新的缓存击穿参数（保留 dl=1 等原有参数）
  function bustUrl() {
    var u = new URL(location.href);
    u.searchParams.set("_fresh", String(Date.now()));
    return u.href;
  }

  function forceRefresh() { location.replace(bustUrl()); }

  // 清掉上一次强制刷新残留的 _fresh 参数，保持地址栏干净（不会触发重新加载）
  (function () {
    var u = new URL(location.href);
    if (u.searchParams.has("_fresh")) {
      u.searchParams.delete("_fresh");
      try { history.replaceState(null, "", u.href); } catch (e) {}
    }
  })();

  /* ---------- 拉远端版本 ---------- */

  var sep = jsonPath.indexOf("?") > -1 ? "&" : "?";
  fetch(jsonPath + sep + "t=" + Date.now(), { cache: "no-store" })
    .then(function (r) { return r.json(); })
    .then(function (v) { boot(v); })
    .catch(function () { boot(null); });   // 拉不到版本信息：只降级显示组件，绝不刷新页面

  function boot(v) {
    buildWidget(v);

    // 版本比对：本地页面内容版本 vs 远端 site 号
    if (!v || pageVer == null || v.site == null) return;   // 信息不全，放弃自动刷新
    if (String(v.site) === String(pageVer)) return;        // 一致，是新页面，啥也不用做

    var key = "fresh:forced:" + v.site;
    if (ssGet(key) === "1") { markStale(); return; }       // 本会话已自动刷过还旧 => 交给手动
    ssSet(key, "1");
    forceRefresh();
  }

  /* ---------- 界面：更新日志 + 一键刷新 ---------- */

  var ui = {};

  function buildWidget(v) {
    var ver = v && v.version ? "v" + v.version : "";
    var dateTxt = v && v.date ? fmtDate(v.date) + "更新" : "";
    var notes = (v && Array.isArray(v.notes)) ? v.notes : [];

    var style = document.createElement("style");
    style.textContent = [
      "#laoyu-fresh{position:fixed;top:72px;right:14px;z-index:60;display:flex;flex-direction:column;align-items:flex-end;gap:8px;font-family:'Segoe UI','微软雅黑',sans-serif}",
      "#laoyu-fresh .lf-row{display:flex;align-items:stretch;gap:8px}",
      "#laoyu-fresh .lf-pill{display:flex;align-items:center;gap:7px;padding:7px 12px;border:2px solid #d5c6a5;border-radius:999px;background:rgba(255,253,246,.95);box-shadow:0 2px 0 #d5c6a5,0 6px 16px rgba(140,110,60,.14);cursor:pointer;font-size:13px;color:#57452f;line-height:1}",
      "#laoyu-fresh .lf-pill:hover{border-color:#e8613c}",
      "#laoyu-fresh .lf-dot{width:8px;height:8px;border-radius:50%;background:#7fa863;box-shadow:0 0 0 3px #e7f0dd;flex-shrink:0}",
      "#laoyu-fresh .lf-dot.stale{background:#e8a13c;box-shadow:0 0 0 3px #fbe3da}",
      "#laoyu-fresh .lf-ver{font-weight:700;color:#cf4a28}",
      "#laoyu-fresh .lf-date{color:#8a7659}",
      "#laoyu-fresh .lf-caret{font-size:10px;color:#b3a184;transition:transform .18s}",
      "#laoyu-fresh.open .lf-caret{transform:rotate(180deg)}",
      "#laoyu-fresh .lf-btn{display:flex;align-items:center;gap:5px;padding:7px 13px;border:2px solid #cf4a28;border-radius:999px;background:#e8613c;color:#fff;font-size:13px;font-weight:700;cursor:pointer;box-shadow:0 2px 0 #cf4a28;line-height:1;transition:transform .18s cubic-bezier(.34,1.56,.64,1)}",
      "#laoyu-fresh .lf-btn:hover{background:#ef7250}",
      "#laoyu-fresh .lf-btn:active{transform:scale(.92)}",
      "#laoyu-fresh .lf-btn .lf-ico{display:inline-block;transition:transform .5s}",
      "#laoyu-fresh .lf-btn:hover .lf-ico{transform:rotate(360deg)}",
      "#laoyu-fresh .lf-panel{display:none;max-width:320px;padding:14px 16px;border:2px solid #d5c6a5;border-radius:16px;background:#fffdf6;box-shadow:0 2px 0 #d5c6a5,0 10px 26px rgba(140,110,60,.18);color:#57452f;font-size:13px;line-height:1.7}",
      "#laoyu-fresh.open .lf-panel{display:block}",
      "#laoyu-fresh .lf-panel h4{margin:0 0 6px;font-size:13.5px}",
      "#laoyu-fresh .lf-panel ul{margin:0 0 8px;padding-left:18px;color:#8a7659}",
      "#laoyu-fresh .lf-panel li{margin:3px 0}",
      "#laoyu-fresh .lf-tip{padding-top:8px;border-top:1px dashed #e6dbc4;color:#8a7659;font-size:12.5px}",
      "#laoyu-fresh .lf-warn{display:none;margin-top:8px;padding:6px 10px;border-radius:10px;background:#fbe3da;color:#cf4a28;font-size:12.5px}",
      "#laoyu-fresh.stale .lf-warn{display:block}",
      "@media (max-width:640px){#laoyu-fresh{top:68px;right:8px}#laoyu-fresh .lf-date{display:none}#laoyu-fresh .lf-panel{max-width:calc(100vw - 24px)}}"
    ].join("");
    document.head.appendChild(style);

    var box = document.createElement("div");
    box.id = "laoyu-fresh";
    box.innerHTML =
      '<div class="lf-row">' +
        '<button class="lf-pill" title="点开看最近更新内容">' +
          '<span class="lf-dot"></span>' +
          (ver ? '<span class="lf-ver">' + esc(ver) + '</span><span class="lf-date">' + esc(dateTxt) + '</span>' : '<span class="lf-ver">更新日志</span>') +
          '<span class="lf-caret">▼</span>' +
        '</button>' +
        '<button class="lf-btn" title="静态页面常有缓存，点一下强制拿最新内容">' +
          '<span class="lf-ico">🔁</span>一键刷新' +
        '</button>' +
      '</div>' +
      '<div class="lf-panel">' +
        '<h4>🧾 最近更新' + (ver ? ' · <span style="color:#cf4a28">' + esc(ver) + '</span>' + (v && v.date ? '（' + esc(v.date) + '）' : '') : '') + '</h4>' +
        (notes.length
          ? '<ul>' + notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>'
          : '<p style="margin:0 0 8px;color:#8a7659">暂时拉不到更新记录，点「一键刷新」试试～</p>') +
        '<div class="lf-tip">📮 静态页面常有缓存，为了拿到最新内容，请勤点旁边的「一键刷新」～</div>' +
        '<div class="lf-warn">⚠️ 检测到本地页面可能是旧缓存（本次会话已自动刷新过一次），再点「一键刷新」试试。</div>' +
      '</div>';

    document.body.appendChild(box);
    ui.box = box;

    box.querySelector(".lf-pill").addEventListener("click", function () {
      box.classList.toggle("open");
    });
    box.querySelector(".lf-btn").addEventListener("click", function () {
      forceRefresh();   // 一级按钮直出发起，无二级菜单、无确认弹窗
    });
    // 点面板外部收起
    document.addEventListener("click", function (e) {
      if (!box.contains(e.target)) box.classList.remove("open");
    });
  }

  // 自动刷新过仍是旧页面时调用：亮黄点 + 显示警告条，不再自动刷新
  function markStale() {
    if (!ui.box) return;
    ui.box.classList.add("stale");
    var dot = ui.box.querySelector(".lf-dot");
    if (dot) dot.classList.add("stale");
  }
})();
