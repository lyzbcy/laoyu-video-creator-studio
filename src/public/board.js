const projectId = new URLSearchParams(location.search).get("project");
const boardEndpoint = "/api/project/" + encodeURIComponent(projectId ?? "");
const $ = (id) => document.getElementById(id);
const viewport = $("viewport");
const world = $("world");
const inspector = $("inspector");
const cardWidth = 302;
const cardHeight = 256;
const view = { x: 0, y: 0, scale: 0.88 };
const cards = new Map();
const thumbnailObserver = new IntersectionObserver((entries) => {
  for (const { target, isIntersecting } of entries) {
    if (!isIntersecting) continue;
    target.src = target.dataset.src;
    thumbnailObserver.unobserve(target);
  }
}, { root: viewport });
let board;
let token;
let selectedId;
let uploadTarget;
let uploads = 0;
let uploadQueue = Promise.resolve();
let saveTimer;
let noticeTimer;
let dirty = false;
let saving = false;
let saveError = false;
let pointer;
let space = false;

function element(tag, { cls, value, ...attributes } = {}, ...children) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (value != null) node.value = value;
  for (const [name, content] of Object.entries(attributes)) node.setAttribute(name, content);
  node.append(...children);
  return node;
}

function button(label, action, options = {}) {
  const node = element("button", { type: "button", ...options }, label);
  node.addEventListener("click", action);
  return node;
}

function toast(message, persistent = false) {
  clearTimeout(noticeTimer);
  $("notice").textContent = message;
  $("notice").hidden = false;
  if (!persistent) noticeTimer = setTimeout(() => { $("notice").hidden = true; }, 5200);
}

async function request(path, options) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "本机工作台连接失败。");
  return data;
}

function showSaveState() {
  const state = $("save-state");
  state.dataset.error = saveError;
  state.textContent = saveError ? "保存失败" : uploads ? `正在导入素材 · 剩余 ${uploads} 项` : dirty || saving ? "正在保存" : "已保存到本机";
  $("retry").hidden = !saveError;
}

function changed() {
  dirty = true;
  showSaveState();
  clearTimeout(saveTimer);
  if (!saveError) saveTimer = setTimeout(save, 260);
}

async function save() {
  if (!dirty || saving) return;
  dirty = false;
  saving = true;
  const retrying = saveError;
  saveError = false;
  showSaveState();
  try {
    const result = await request(boardEndpoint + "/board", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Board-Token": token },
      body: JSON.stringify(board),
    });
    board.revision = result.revision;
    if (retrying) toast("已保存到本机");
  } catch (error) {
    dirty = true;
    saveError = true;
    toast(error.message, true);
  } finally {
    saving = false;
    showSaveState();
    if (dirty && !saveError) save();
  }
}

window.flushStudioBoard = async () => {
  clearTimeout(saveTimer);
  await uploadQueue;
  while (saving) await new Promise(resolve => setTimeout(resolve, 35));
  if (dirty && !saveError) await save();
  if (dirty || saving || saveError) throw new Error("画布还没有保存，请先处理保存提示。");
};
window.addEventListener("message", (event) => {
  if (event.origin === location.origin && event.source === parent && event.data === "studio-hide") {
    document.querySelectorAll("video,audio").forEach(player => player.pause());
  }
});

function selected() {
  return board.scenes.find((scene) => scene.id === selectedId);
}

function findAsset(id) {
  return board.assets.find((asset) => asset.id === id);
}

function mediaURL(asset) {
  return boardEndpoint + "/media/" + encodeURIComponent(asset.file.split("/").at(-1));
}

function mediaKind(asset) {
  return asset.mime.split("/")[0];
}

function place(card, scene) {
  card.style.left = scene.x + "px";
  card.style.top = scene.y + "px";
}

function cardPreview(asset) {
  const kind = mediaKind(asset);
  if (kind === "image") return element("img", { src: mediaURL(asset), alt: "", loading: "lazy" });
  const icon = element("span", { cls: "media-symbol", "aria-hidden": "true" }, kind === "audio" ? "♫" : "▷");
  if (kind === "audio") return icon;
  const preview = element("video", { "data-src": mediaURL(asset), "aria-hidden": "true", muted: "", playsinline: "", preload: "metadata" });
  preview.addEventListener("error", () => preview.replaceWith(icon));
  thumbnailObserver.observe(preview);
  return preview;
}

function updateCard(scene) {
  const card = cards.get(scene.id);
  place(card, scene);
  card.querySelector(".shot-script").textContent = scene.text;
  const drop = card.querySelector(".shot-drop");
  const oldPreview = drop.querySelector("video");
  if (oldPreview) thumbnailObserver.unobserve(oldPreview);
  const first = findAsset(scene.clips[0]?.assetId);
  drop.classList.toggle("filled", !!first);
  if (first) {
    drop.replaceChildren(cardPreview(first), element("strong", { title: first.name }, first.name));
    drop.setAttribute("aria-label", "查看 " + scene.id + " 已绑定素材");
  } else {
    drop.replaceChildren(element("span", { cls: "plus", "aria-hidden": "true" }, "+"),
      element("strong", {}, "放入这一镜的素材"), element("small", {}, "拖入 · 粘贴 · 点击选择"));
    drop.setAttribute("aria-label", "添加到 " + scene.id);
  }
  updateShotBadge(scene);
}

function updateShotBadge(scene) {
  const badge = cards.get(scene.id).querySelector(".shot-meta b");
  const markers = sourceBoard.references(scene).length;
  badge.classList.toggle("ready", !!(scene.clips.length || markers));
  badge.textContent = markers ? markers + " 处时间标注" : scene.clips.length ? scene.clips.length + " 项素材" : "待素材";
}

function buildCanvas() {
  for (const [index, chapter] of board.chapters.entries()) {
    const heading = element("section", { cls: "chapter" },
      element("b", {}, String(index + 1).padStart(2, "0") + " /"),
      element("h2", {}, chapter.name), element("span", {}, chapter.label));
    heading.style.left = "56px";
    heading.style.top = (54 + 324 * index) + "px";
    world.append(heading);
  }
  for (const scene of board.scenes) buildShot(scene);
}

function buildShot(scene) {
    const card = element("article", { cls: "shot", "data-shot": scene.id },
      element("header", { cls: "shot-head", title: "拖动标题可移动镜头卡片" },
        element("h3", {}, element("span", {}, scene.id), scene.title), element("span", { cls: "grip", "aria-hidden": "true" }, "⠿")),
      element("p", { cls: "shot-script" }),
      button("", () => {
        select(scene.id);
        if (!scene.clips.length) pickFiles(scene.id);
        else inspector.querySelector(".source-heading")?.scrollIntoView({ block: "nearest" });
      }, { cls: "shot-drop" }),
      element("div", { cls: "shot-meta" }, sourceBoard.sceneDrag(scene, "拖入口播"), element("b")));
    world.append(card);
    cards.set(scene.id, card);
    updateCard(scene);
}

function renderOutline() {
  const nav = $("outline-list");
  const scroll = nav.scrollTop;
  const items = [];
  let offset = 0;
  let count = 0;
  for (const [index, chapter] of board.chapters.entries()) {
    items.push(element("div", { cls: "nav-group" }, "0" + (index + 1) + "  " + chapter.name));
    for (const scene of board.scenes.slice(offset, offset + chapter.count)) {
      const item = button("", () => select(scene.id, true), { cls: "nav-shot", "aria-current": scene.id === selectedId });
      item.append(element("span", { cls: "num" }, scene.id), scene.title);
      sourceBoard.makeDraggable(item, scene);
      if (scene.clips.length || sourceBoard.references(scene).length) {
        item.append(element("i", { cls: "ready", "aria-label": "已关联素材" }));
        count++;
      }
      items.push(item);
    }
    offset += chapter.count;
  }
  nav.replaceChildren(...items);
  nav.scrollTop = scroll;
  nav.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "nearest" });
  $("progress-label").textContent = count + " / " + board.scenes.length + " 镜已关联素材";
  $("progress").max = board.scenes.length;
  $("progress").value = count;
  $("asset-count").textContent = board.assets.length;
}

function field(scene, key, label, rows) {
  const input = element("textarea", { rows, value: scene[key] });
  input.addEventListener("input", () => {
    scene[key] = input.value;
    if (key === "text") cards.get(scene.id).querySelector(".shot-script").textContent = scene.text;
    changed();
  });
  return element("label", { cls: "field" }, element("span", {}, label), input);
}

function clipTime(clip, key, label, media) {
  const input = element("input", {
    type: "number", min: 0, step: 0.001, value: clip[key] ?? "", placeholder: "待定",
    "aria-label": label + "（秒）",
  });
  function update() {
    const time = input.value === "" ? null : input.valueAsNumber;
    const start = key === "in" ? time : clip.in;
    const end = key === "out" ? time : clip.out;
    const exceedsDuration = time != null && Number.isFinite(media.duration) && time > media.duration + 0.001;
    if (!input.validity.valid || exceedsDuration || (end != null && end <= (start ?? 0))) {
      toast(exceedsDuration ? "源时间超出了素材的时长。" : "源时间需为非负秒数，出点须晚于入点。");
      input.value = clip[key] ?? "";
      return;
    }
    clip[key] = time;
    changed();
  }
  input.addEventListener("change", update);
  const jump = button("取播放头", () => {
    if (media.readyState < 1) {
      toast("请先加载素材预览。");
      return;
    }
    input.value = media.currentTime.toFixed(3);
    update();
  }, { title: "把当前播放时间记为" + label });
  return element("div", {}, element("span", {}, label + " / 秒", jump), input);
}

function renderClip(scene, clip) {
  const asset = findAsset(clip.assetId);
  if (!asset) return element("p", { cls: "clip-error" }, "素材记录缺失，请检查画布文件。");
  const remove = button("移出此镜", () => {
    scene.clips = scene.clips.filter((item) => item !== clip);
    refreshMaterials(scene);
  }, { title: "素材仍可在素材库重新绑定" });
  const box = element("section", { cls: "clip" },
    element("div", { cls: "clip-heading" }, element("strong", {}, asset.name), remove));
  box.append(button("在素材时间轴标注", () => sourceBoard.open(asset, true), { cls: "clip-timeline" }));
  const error = element("p", { cls: "clip-error", hidden: "" }, "浏览器无法预览此源文件。原件已留在素材库，仍可交给剪辑软件。");
  const kind = mediaKind(asset);
  const media = kind === "image"
    ? element("img", { alt: asset.name })
    : element(kind, { controls: "", preload: "metadata", playsinline: "" });
  media.addEventListener("error", () => { error.hidden = false; });
  media.src = mediaURL(asset);
  box.append(media, error);
  if (kind !== "image") {
    box.append(element("div", { cls: "source-times" }, clipTime(clip, "in", "入点", media), clipTime(clip, "out", "出点", media)));
  }
  const note = element("input", { cls: "clip-note", value: clip.note, placeholder: "素材用法，例如用作画中画", "aria-label": "此素材的剪辑备注" });
  note.addEventListener("input", () => { clip.note = note.value; changed(); });
  box.append(note);
  return box;
}

function renderInspector() {
  const scene = selected();
  const index = board.scenes.indexOf(scene);
  const step = (delta) => select(board.scenes[index + delta].id, true);
  const back = button("←", () => step(-1), { "aria-label": "上一镜" });
  const next = button("→", () => step(1), { "aria-label": "下一镜" });
  back.disabled = index === 0;
  next.disabled = index === board.scenes.length - 1;
  const nodes = [
    element("div", { cls: "inspector-top" }, element("span", { cls: "section-label" }, "SHOT " + scene.id + " / " + board.scenes.length),
      element("div", { cls: "inspect-nav" }, back, next)),
    element("h2", {}, scene.title),
    element("span", { cls: "kind" }, scene.kind),
    field(scene, "text", "口播原文 · 可编辑", Math.max(2, Math.min(6, Math.ceil(scene.text.length / 20)))),
    element("div", { cls: "source-heading" }, element("strong", {}, "这一镜的原素材"),
      button("+ 添加素材", () => pickFiles(scene.id))),
    ...scene.clips.map((clip) => renderClip(scene, clip)),
    field(scene, "cue", "拍摄 / 画面提示", 3),
    field(scene, "sound", "声音 / 剪辑提示", 2),
    field(scene, "notes", "交接备注", 2),
  ];
  if (!scene.clips.length) nodes.splice(5, 0, element("p", { cls: "source-empty" }, "拖到这张卡片上，或选中镜头后按 Ctrl+V 粘贴剪贴板中的素材。"));
  inspector.replaceChildren(...nodes);
}

function select(id, focus = false) {
  if (id !== selectedId || sourceBoard.inspecting()) {
    sourceBoard.leaveInspector();
    cards.get(selectedId)?.classList.remove("selected");
    selectedId = id;
    cards.get(id).classList.add("selected");
    renderOutline();
    renderInspector();
    inspector.scrollTop = 0;
  }
  if (focus) centerShot();
}

function setTransform() {
  world.style.transform = "translate(" + view.x + "px," + view.y + "px) scale(" + view.scale + ")";
  $("zoom-label").textContent = Math.round(view.scale * 100) + "%";
}

function zoom(scale, x = viewport.clientWidth / 2, y = viewport.clientHeight / 2) {
  const next = Math.max(0.05, Math.min(2.2, scale));
  const ratio = next / view.scale;
  view.x = x - (x - view.x) * ratio;
  view.y = y - (y - view.y) * ratio;
  view.scale = next;
  setTransform();
}

function centerShot() {
  centerItem(selected());
}

function centerItem(scene) {
  view.scale = Math.max(0.65, view.scale);
  view.x = (viewport.clientWidth - cardWidth * view.scale) / 2 - scene.x * view.scale;
  view.y = (viewport.clientHeight - cardHeight * view.scale) / 2 - scene.y * view.scale;
  setTransform();
}

function fit() {
  const items = [...board.scenes, ...board.assets.map((asset) => sourceBoard.position(asset))];
  const xs = items.map((scene) => scene.x);
  const ys = items.map((scene) => scene.y);
  const x = Math.min(36, ...xs);
  const y = Math.min(44, ...ys);
  const width = Math.max(...xs) + cardWidth - x;
  const height = Math.max(1323, Math.max(...ys) + cardHeight) - y;
  view.scale = Math.min(1, (viewport.clientWidth - 30) / width, (viewport.clientHeight - 94) / height);
  view.x = (viewport.clientWidth - width * view.scale) / 2 - x * view.scale;
  view.y = (viewport.clientHeight - height * view.scale) / 2 - y * view.scale;
  setTransform();
}

function pointerStart(event) {
  if (!board || event.target.closest(".zoom-bar")) return;
  if (event.button !== 0 && event.button !== 1) return;
  if (event.button === 0 && event.target.closest("[draggable=true]") && !space) return;
  const card = event.target.closest(".shot");
  const pan = event.button === 1 || space || !card;
  const asset = card?.dataset.asset && findAsset(card.dataset.asset);
  if (!pan && !asset) select(card.dataset.shot);
  if (!pan && !event.target.closest(".shot-head")) return;
  const scene = pan ? null : asset ? sourceBoard.position(asset, true) : selected();
  pointer = {
    id: event.pointerId, scene, card, asset, x: event.clientX, y: event.clientY,
    startX: scene ? scene.x : view.x, startY: scene ? scene.y : view.y, moved: false,
  };
  event.preventDefault();
  viewport.setPointerCapture(event.pointerId);
}

function pointerMove(event) {
  if (pointer?.id !== event.pointerId) return;
  const dx = event.clientX - pointer.x;
  const dy = event.clientY - pointer.y;
  if (!pointer.moved && Math.hypot(dx, dy) < 3) return;
  pointer.moved = true;
  const { scene, card, startX, startY } = pointer;
  if (scene) {
    scene.x = Math.round(startX + dx / view.scale);
    scene.y = Math.round(startY + dy / view.scale);
    place(card, scene);
  } else {
    view.x = startX + dx;
    view.y = startY + dy;
    setTransform();
  }
}

function pointerEnd(event) {
  if (pointer?.id !== event.pointerId) return;
  if (pointer.scene && pointer.moved) changed();
  if (pointer.scene && pointer.asset && !pointer.moved && event.type === "pointerup") sourceBoard.open(pointer.asset);
  pointer = null;
}

function refreshMaterials(scene) {
  updateCard(scene);
  renderOutline();
  if (scene.id === selectedId && !sourceBoard.inspecting()) {
    const scroll = inspector.scrollTop;
    renderInspector();
    inspector.scrollTop = scroll;
  }
  if ($("library-dialog").open) renderLibrary();
  changed();
}

function attach(scene, asset) {
  scene.clips.push({ assetId: asset.id, in: null, out: null, note: "" });
  refreshMaterials(scene);
}

function pickFiles(id) {
  uploadTarget = id;
  $("files").click();
}

function queueFiles(id, files, point) {
  if (!files.length) return;
  const scene = board.scenes.find((item) => item.id === id);
  uploads += files.length;
  showSaveState();
  uploadQueue = uploadQueue.then(async () => {
    let count = 0;
    let first;
    const errors = [];
    for (const file of files) {
      try {
        const asset = await request(boardEndpoint + "/media", {
          method: "POST",
          headers: { "X-Board-Token": token, "X-File-Name": encodeURIComponent(file.name) },
          body: file,
        });
        if (point) asset.position = { x: point.x + 326 * count, y: point.y };
        board.assets.push(asset);
        sourceBoard.addCard(asset);
        if (scene) attach(scene, asset);
        else {
          renderOutline();
          if ($("library-dialog").open) renderLibrary();
          changed();
        }
        first ??= asset;
        count++;
      } catch (error) {
        errors.push(error.message);
      } finally {
        uploads--;
        showSaveState();
      }
    }
    if (first && !scene) sourceBoard.open(first, true);
    const destination = scene ? scene.id + " 镜" : "原素材画布";
    toast([count ? "已添加 " + count + " 项至 " + destination : "", ...errors].filter(Boolean).join("。"));
  });
}

function renderLibrary() {
  const scene = selected();
  $("library-hint").textContent = board.assets.length
    ? "打开原片时间轴做标注，也可以复用到 " + scene.id + " 镜。"
    : "还没有原片。把文件拖到画布空白处，或点击「导入原片」。";
  $("library-list").replaceChildren(...board.assets.map((asset) => {
    const use = button("用在 " + scene.id, () => {
      attach(scene, asset);
      $("library-dialog").close();
      toast("已将素材绑定到 " + scene.id + " 镜");
    });
    const timeline = button("时间轴", () => {
      $("library-dialog").close();
      sourceBoard.open(asset, true);
    });
    return element("div", { cls: "asset-row" }, element("strong", {}, asset.name),
      element("div", { cls: "asset-actions" }, timeline, use));
  }));
}

function exportSheet() {
  const lines = ["# " + board.title + " · 剪辑单", "",
    "按编号剪辑。源时间单位为秒。文件路径相对于画布项目目录。", ""];
  for (const scene of board.scenes) {
    lines.push("## " + scene.id + " " + scene.title, "", "**口播**", "", scene.text, "",
      "**画面提示** " + scene.cue, "", "**声音 / 剪辑提示** " + (scene.sound || "待定"), "",
      "**交接备注** " + (scene.notes || "无"), "", "**源素材**", "");
    const marked = sourceBoard.references(scene);
    if (!scene.clips.length && !marked.length) lines.push("- 待贴素材");
    for (const { item, note, time } of marked) {
      lines.push("- " + item.name + " ｜ " + item.file + " ｜ " + time + (note.comment ? " ｜ " + note.comment.replace(/\r?\n/g, " ") : ""));
    }
    for (const clip of scene.clips) {
      const asset = findAsset(clip.assetId);
      if (!asset) {
        lines.push("- 素材记录缺失 " + clip.assetId);
        continue;
      }
      const time = mediaKind(asset) === "image" ? "" : " ｜ 源入点 " + (clip.in ?? "待定") + " ｜ 源出点 " + (clip.out ?? "待定");
      lines.push("- " + asset.name + " ｜ " + asset.file + time + (clip.note ? " ｜ " + clip.note : ""));
    }
    lines.push("");
  }
  sourceBoard.appendExport(lines);
  const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" }));
  const link = element("a", { href: url, download: "两台电脑一双手-剪辑单.md" });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function bindEvents() {
  $("files").addEventListener("change", (event) => {
    queueFiles(uploadTarget, Array.from(event.target.files));
    event.target.value = "";
  });
  $("add-shot").addEventListener("click", () => {
    const title = window.prompt("分镜名称", "新分镜")?.trim();
    if (!title) return;
    const id = String(Math.max(0, ...board.scenes.map((scene) => Number(scene.id) || 0)) + 1).padStart(2, "0");
    const current = selected();
    const scene = { id, title: title.slice(0, 100), kind: "分镜", text: "", cue: "", sound: "", notes: "",
      x: current.x + 324, y: current.y, clips: [] };
    board.scenes.push(scene);
    board.chapters.at(-1).count++;
    buildShot(scene);
    select(id, true);
    changed();
  });
  $("upload-source").addEventListener("click", () => pickFiles(null));
  $("retry").addEventListener("click", save);
  $("library").addEventListener("click", () => { renderLibrary(); $("library-dialog").showModal(); });
  $("export").addEventListener("click", exportSheet);
  $("fit").addEventListener("click", fit);
  $("zoom-out").addEventListener("click", () => zoom(view.scale / 1.2));
  $("zoom-in").addEventListener("click", () => zoom(view.scale * 1.2));
  $("zoom-reset").addEventListener("click", () => { view.scale = 1; centerItem(sourceBoard.activePosition() ?? selected()); });
  viewport.addEventListener("pointerdown", pointerStart);
  viewport.addEventListener("pointermove", pointerMove);
  viewport.addEventListener("pointerup", pointerEnd);
  viewport.addEventListener("pointercancel", pointerEnd);
  viewport.addEventListener("wheel", (event) => {
    event.preventDefault();
    const box = viewport.getBoundingClientRect();
    zoom(view.scale * Math.exp(-Math.sign(event.deltaY) * 0.11), event.clientX - box.left, event.clientY - box.top);
  }, { passive: false });
  const clearDrop = () => viewport.querySelector(".shot.over")?.classList.remove("over");
  viewport.addEventListener("dragover", (event) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    clearDrop();
    const card = event.target.closest(".shot");
    viewport.classList.toggle("over", !card);
    card?.classList.add("over");
  });
  viewport.addEventListener("dragleave", (event) => {
    if (viewport.contains(event.relatedTarget)) return;
    viewport.classList.remove("over");
    clearDrop();
  });
  viewport.addEventListener("drop", (event) => {
    if (!event.dataTransfer.files.length) return;
    event.preventDefault();
    viewport.classList.remove("over");
    clearDrop();
    const id = event.target.closest(".shot")?.dataset.shot;
    if (id) select(id);
    const box = viewport.getBoundingClientRect();
    const point = id ? null : {
      x: Math.round((event.clientX - box.left - view.x) / view.scale),
      y: Math.round((event.clientY - box.top - view.y) / view.scale),
    };
    queueFiles(id, Array.from(event.dataTransfer.files), point);
  });
  window.addEventListener("dragover", (event) => {
    if (event.dataTransfer.types.includes("Files")) event.preventDefault();
  });
  window.addEventListener("drop", (event) => {
    if (event.dataTransfer.files.length) event.preventDefault();
  });
  window.addEventListener("paste", (event) => {
    const files = Array.from(event.clipboardData.files);
    if (!files.length || $("library-dialog").open) return;
    event.preventDefault();
    queueFiles(sourceBoard.inspecting() ? null : selectedId, files);
  });
  window.addEventListener("keydown", (event) => {
    if (event.code !== "Space" || event.target.closest("input,textarea,button,video,audio,dialog")) return;
    event.preventDefault();
    space = true;
  });
  window.addEventListener("keyup", (event) => { if (event.code === "Space") space = false; });
  window.addEventListener("blur", () => { space = false; });
  window.addEventListener("beforeunload", (event) => {
    if (dirty || saving || uploads) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
}

async function init() {
  try {
    ({ board, token } = await request(boardEndpoint + "/board"));
    $("board-title").textContent = board.title;
    buildCanvas();
    sourceBoard.init();
    select(board.scenes[0].id);
    view.scale = viewport.clientWidth < 520 ? 0.83 : 0.88;
    view.x = 23 - 56 * view.scale;
    view.y = 44 - 54 * view.scale;
    setTransform();
    showSaveState();
    bindEvents();
    const review = findAsset(new URLSearchParams(location.search).get("review"));
    if (review) sourceBoard.open(review, true);
  } catch (error) {
    $("save-state").textContent = "读取失败";
    $("save-state").dataset.error = true;
    toast("无法打开画布。 " + error.message, true);
  }
}

document.addEventListener("DOMContentLoaded", init);
