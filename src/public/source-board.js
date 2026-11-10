const sourceBoard = (() => {
  const sceneType = "application/x-laoyu-scene";
  const dock = $("source-dock");
  const sourceCards = new Map();
  let asset;
  let noteId;
  let sourceInspector = false;
  let media;
  let clock;
  let exact;
  let selectionLabel;
  let rangeToggle;
  let scroller;
  let track;
  let ticks;
  let markerLayer;
  let playhead;
  let shade;
  let zoom = 1;
  let cursor = 0;
  let selection;
  let rangeMode = false;
  let gesture;

  const notes = (item) => item.annotations ?? [];
  const duration = () => asset?.duration ?? 0;
  const round = (seconds) => Math.round(seconds * 1000) / 1000;
  const clamp = (seconds) => Math.max(0, Math.min(duration(), round(seconds)));
  const ordered = (item) => [...notes(item)].sort((a, b) => a.start - b.start);

  function stamp(seconds) {
    const ms = Math.round(seconds * 1000);
    const minutes = Math.floor(ms / 60000);
    return String(minutes).padStart(2, "0") + ":" +
      String(Math.floor(ms / 1000) % 60).padStart(2, "0") + "." +
      String(ms % 1000).padStart(3, "0");
  }

  function timeLabel(item) {
    return stamp(item.start) + (item.end == null ? "" : " – " + stamp(item.end));
  }

  function references(scene) {
    return board.assets.flatMap((item) => ordered(item)
      .filter((note) => note.sceneId === scene.id)
      .map((note) => ({ item, note, time: timeLabel(note) })));
  }

  function position(item, persist = false) {
    if (item.position) return item.position;
    const index = board.assets.indexOf(item);
    const point = { x: 1370 + Math.floor(index / 4) * 326, y: 95 + (index % 4) * 324 };
    if (persist) item.position = point;
    return point;
  }

  function updateCard(item) {
    const card = sourceCards.get(item.id);
    card.classList.toggle("selected", item === asset);
    card.querySelector(".source-card-meta").textContent =
      (item.duration == null ? "原素材" : stamp(item.duration)) + " · " + notes(item).length + " 条标注";
  }

  function addCard(item) {
    const preview = button("", () => open(item), {
      cls: "shot-drop filled source-preview", "aria-label": "打开原片时间轴 " + item.name,
    });
    preview.replaceChildren(cardPreview(item), element("strong", { title: item.name }, item.name));
    const card = element("article", { cls: "shot source-card", "data-asset": item.id },
      element("header", { cls: "shot-head", title: "拖动标题可摆放素材卡片" },
        element("h3", {}, element("span", {}, "SOURCE"), "原素材"), element("span", { cls: "grip" }, "⠿")),
      preview, element("div", { cls: "shot-meta" }, element("span", { cls: "source-card-meta" }), element("b", { cls: "ready" }, "点开时间轴")));
    world.append(card);
    sourceCards.set(item.id, card);
    place(card, position(item));
    updateCard(item);
  }

  function makeDraggable(node, scene) {
    node.draggable = true;
    node.title = "拖到原片时间轴，可绑定这一段口播";
    node.addEventListener("dragstart", (event) => {
      event.dataTransfer.effectAllowed = "copy";
      event.dataTransfer.setData(sceneType, scene.id);
      event.dataTransfer.setData("text/plain", scene.text.trim());
      dock.classList.add("expecting-drop");
    });
    node.addEventListener("dragend", () => dock.classList.remove("expecting-drop", "drop-active"));
  }

  function sceneDrag(scene, text) {
    const handle = element("span", { cls: "scene-drag" }, "⠿ " + text);
    makeDraggable(handle, scene);
    return handle;
  }

  function open(item, center = false) {
    if (asset !== item) {
      media?.pause?.();
      const previous = asset;
      asset = item;
      if (previous) updateCard(previous);
      noteId = undefined;
      selection = undefined;
      rangeMode = false;
      cursor = 0;
      zoom = 1;
      dock.hidden = false;
      renderDock();
      updateCard(item);
    }
    showInspector();
    if (center) centerItem(position(item));
  }

  function close() {
    media?.pause?.();
    const previous = asset;
    asset = undefined;
    gesture = undefined;
    dock.hidden = true;
    dock.replaceChildren();
    dock.classList.remove("expecting-drop", "drop-active");
    updateCard(previous);
    if (sourceInspector) select(selectedId);
  }

  function setCursor(seconds, sync = true) {
    cursor = clamp(seconds);
    if (sync && media?.readyState >= 1 && Math.abs(media.currentTime - cursor) > 0.001) {
      media.currentTime = Math.min(media.duration, cursor);
    }
    if (!clock) return;
    clock.textContent = stamp(cursor) + " / " + stamp(duration());
    if (exact !== document.activeElement) exact.value = cursor;
    playhead.style.left = percent(cursor);
    playhead.setAttribute("aria-valuenow", cursor);
    playhead.setAttribute("aria-valuemax", duration());
  }

  function percent(seconds) {
    return (duration() ? seconds * 100 / duration() : 0) + "%";
  }

  function timeAt(event) {
    const rect = track.getBoundingClientRect();
    return clamp((event.clientX - rect.left) / rect.width * duration());
  }

  function inView(seconds) {
    if (!duration()) return;
    const offset = seconds / duration() * track.clientWidth;
    if (offset < scroller.scrollLeft || offset > scroller.scrollLeft + scroller.clientWidth - 18) {
      scroller.scrollLeft = offset - scroller.clientWidth * 0.25;
    }
  }

  function renderSelection() {
    const span = selection?.end > selection?.start;
    shade.hidden = !span;
    if (span) {
      shade.style.left = percent(selection.start);
      shade.style.width = percent(selection.end - selection.start);
    }
    selectionLabel.textContent = span ? "已选 " + timeLabel(selection) : rangeMode ? "拖动刻度，框选一段时间" : "点刻度定位 · 拖入口播卡";
    rangeToggle.setAttribute("aria-pressed", rangeMode);
  }

  function renderTrack() {
    track.style.width = zoom * 100 + "%";
    ticks.replaceChildren();
    const total = duration();
    const ideal = total / Math.max(2, Math.floor(track.clientWidth / 82));
    const unit = 10 ** Math.floor(Math.log10(ideal || 1));
    const spacing = Math.max(0.001, ([1, 2, 5, 10].find((step) => step * unit >= ideal) ?? 10) * unit);
    for (let time = 0; time <= total + 0.0000001; time += spacing) {
      const tick = element("span", { cls: "time-tick" }, stamp(time).replace(/\.000$/, ""));
      tick.style.left = percent(time);
      ticks.append(tick);
    }
    setCursor(cursor, false);
    renderSelection();
    renderMarkers();
  }

  function renderMarkers() {
    const laneEnds = [];
    const width = track.clientWidth;
    markerLayer.replaceChildren(...ordered(asset).map((note) => {
      const x = duration() ? note.start / duration() * width : 0;
      const end = duration() && note.end != null ? note.end / duration() * width : x;
      const desired = Math.max(46, Math.min(140, note.title.length * 12 + 22), end - x);
      let lane = laneEnds.findIndex((last) => last <= x);
      if (lane < 0) lane = laneEnds.length;
      laneEnds[lane] = x + desired + 5;
      const marker = button(note.title, () => selectNote(note), {
        cls: "time-marker", "data-marker": note.id, "aria-label": timeLabel(note) + " " + note.title,
        title: timeLabel(note) + " · " + note.title + "，可拖动时间",
      });
      marker.classList.toggle("point", note.end == null);
      marker.classList.toggle("script", !!note.sceneId);
      marker.classList.toggle("current", note.id === noteId);
      marker.style.left = percent(note.start);
      marker.style.top = 4 + lane * 27 + "px";
      marker.style.width = desired + "px";
      if (end > x) {
        const band = element("span", { cls: "marker-span" });
        band.style.width = Math.max(1, end - x) + "px";
        marker.append(band);
      }
      return marker;
    }));
    track.style.height = Math.max(94, 58 + laneEnds.length * 27) + "px";
  }

  function pointerStart(event) {
    if (event.button !== 0) return;
    const marker = event.target.closest(".time-marker");
    const time = timeAt(event);
    const note = marker && notes(asset).find((item) => item.id === marker.dataset.marker);
    if (note) {
      gesture = { type: "move", note, time, start: note.start, end: note.end, x: event.clientX };
    } else if (rangeMode || event.shiftKey) {
      gesture = { type: "range", time };
      selection = { start: time, end: time };
      renderSelection();
      setCursor(time);
    } else {
      gesture = { type: "seek" };
      selection = undefined;
      renderSelection();
      setCursor(time);
    }
    track.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function pointerMove(event) {
    if (!gesture) return;
    const time = timeAt(event);
    if (gesture.type === "move") {
      if (!gesture.moved && Math.abs(event.clientX - gesture.x) < 4) return;
      gesture.moved = true;
      const span = gesture.end == null ? 0 : gesture.end - gesture.start;
      const start = clamp(Math.min(duration() - span, gesture.start + time - gesture.time));
      gesture.note.start = start;
      gesture.note.end = gesture.end == null ? null : clamp(start + span);
      setCursor(start);
      renderMarkers();
    } else if (gesture.type === "range") {
      selection = { start: Math.min(gesture.time, time), end: Math.max(gesture.time, time) };
      renderSelection();
      setCursor(time);
    } else {
      setCursor(time);
    }
  }

  function pointerEnd() {
    if (!gesture) return;
    const current = gesture;
    gesture = undefined;
    if (current.type === "move") {
      if (current.moved) changed();
      selectNote(current.note);
    } else if (current.type === "range") {
      rangeMode = false;
      if (!(selection?.end > selection?.start)) selection = undefined;
      renderSelection();
    }
  }

  function selectNote(note, focus = false) {
    noteId = note.id;
    setCursor(note.start);
    if (focus) inView(note.start);
    renderMarkers();
    showInspector();
  }

  function addNote(time, scene, text, focus = false, useSelection = false) {
    if (!asset) return;
    if (!duration() && mediaKind(asset) !== "image") {
      $("source-duration")?.removeAttribute("hidden");
      toast("原片时长尚未就绪。可以等预览加载，或手填时长。");
      return;
    }
    const interval = selection?.end > selection?.start &&
      (useSelection || (time >= selection.start && time <= selection.end));
    const note = {
      id: crypto.randomUUID(),
      start: interval ? selection.start : clamp(time),
      end: interval ? selection.end : null,
      title: scene?.title ?? (text ? text.split(/\r?\n/, 1)[0].slice(0, 42) : "新批注"),
      comment: scene ? "" : text ?? "",
    };
    if (scene) note.sceneId = scene.id;
    (asset.annotations ??= []).push(note);
    selection = undefined;
    rangeMode = false;
    renderSelection();
    updateCard(asset);
    if (scene) {
      updateShotBadge(scene);
      renderOutline();
    }
    selectNote(note, true);
    changed();
    if (focus) {
      const field = $("annotation-title");
      field.focus();
      field.select();
    }
  }

  function setDuration(item, seconds) {
    if (item !== asset || !Number.isFinite(seconds) || seconds <= 0) return;
    const floor = Math.max(0, ...notes(item).map((note) => note.end ?? note.start));
    const next = Math.max(floor, round(seconds));
    if (next !== item.duration) {
      item.duration = next;
      updateCard(item);
      changed();
    }
    exact.max = next;
    renderTrack();
  }

  function renderDock() {
    const item = asset;
    const kind = mediaKind(item);
    const isImage = kind === "image";
    media = isImage ? element("img", { alt: item.name }) : element(kind, { controls: "", preload: "metadata", playsinline: "" });
    const fallback = element("p", { cls: "source-play-error", hidden: "" }, "浏览器无法播放此原片。可手填原片时长后继续标注。");
    media.addEventListener("error", () => { fallback.hidden = false; if (!isImage) $("source-duration")?.removeAttribute("hidden"); });
    media.addEventListener("loadedmetadata", () => setDuration(item, media.duration));
    media.addEventListener("timeupdate", () => {
      if (item !== asset || gesture) return;
      setCursor(media.currentTime, false);
      if (!media.paused) inView(cursor);
    });
    media.src = mediaURL(item);
    const manual = element("input", { type: "number", min: 0.001, step: 0.001, value: item.duration ?? "", "aria-label": "原片时长（秒）" });
    manual.addEventListener("change", () => {
      if (manual.validity.valid && manual.value) setDuration(item, manual.valueAsNumber);
      manual.value = item.duration ?? "";
    });
    exact = element("input", { type: "number", min: 0, max: duration(), step: 0.001, value: 0, "aria-label": "播放头（秒）" });
    exact.addEventListener("change", () => { setCursor(exact.valueAsNumber || 0); exact.value = cursor; inView(cursor); });
    clock = element("span", { cls: "source-clock" });
    selectionLabel = element("span", { cls: "selection-label" });
    rangeToggle = button("框选时段", () => {
      if (!duration()) { toast("请先加载原片时长。"); return; }
      rangeMode = !rangeMode;
      selection = undefined;
      renderSelection();
    }, { "aria-pressed": "false" });
    const header = element("header", { cls: "dock-header" },
      element("span", { cls: "section-label" }, "原素材时间轴"),
      button(item.name, showInspector, { cls: "dock-name", title: item.name }),
      clock, button("×", close, { cls: "dock-close", "aria-label": "关闭素材时间轴" }));
    const controls = element("div", { cls: "time-controls" },
      element("label", { cls: "time-exact" }, "定位到", exact, "秒"),
      rangeToggle,
      button("绑定所选分镜", () => addNote(cursor, selected(), null, false, true), { title: "将左侧当前选中的分镜放到播放头或已选区间" }),
      button("＋ 批注", () => addNote(cursor, null, null, true, true), { cls: "primary" }),
      button("−", () => zoomTrack(0.5), { "aria-label": "缩小时间轴" }),
      button("+", () => zoomTrack(2), { "aria-label": "放大时间轴" }));
    ticks = element("div", { cls: "ticks", "aria-hidden": "true" });
    markerLayer = element("div", { cls: "marker-layer" });
    shade = element("div", { cls: "time-selection", hidden: "" });
    playhead = element("div", { cls: "playhead", role: "slider", tabindex: "0", "aria-label": "时间轴播放头", "aria-valuemin": "0" });
    playhead.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      setCursor(cursor + (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 5 : 0.1));
      inView(cursor);
    });
    track = element("div", { cls: "source-track", "aria-label": "拖动播放头或在此放入口播卡" },
      ticks, element("div", { cls: "source-rail" }, "原片"), shade, markerLayer, playhead);
    scroller = element("div", { cls: "timeline-scroller" }, track);
    track.addEventListener("pointerdown", pointerStart);
    track.addEventListener("pointermove", pointerMove);
    track.addEventListener("pointerup", pointerEnd);
    track.addEventListener("pointercancel", pointerEnd);
    track.addEventListener("dragover", (event) => {
      if (![sceneType, "text/plain"].some((type) => event.dataTransfer.types.includes(type))) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      dock.classList.add("drop-active");
    });
    track.addEventListener("dragleave", (event) => {
      if (!track.contains(event.relatedTarget)) dock.classList.remove("drop-active");
    });
    track.addEventListener("drop", (event) => {
      event.preventDefault();
      dock.classList.remove("drop-active", "expecting-drop");
      const sceneId = event.dataTransfer.getData(sceneType);
      const scene = board.scenes.find((candidate) => candidate.id === sceneId);
      const text = event.dataTransfer.getData("text/plain").trim();
      if (scene || text) addNote(timeAt(event), scene, text);
    });
    dock.replaceChildren(header, element("div", { cls: "dock-body" },
      element("div", { cls: "source-player" }, media, fallback,
        element("label", { cls: "time-exact", id: "source-duration", hidden: "" }, "原片时长", manual, "秒")),
      element("div", { cls: "timeline-work" }, controls, scroller, selectionLabel)));
    renderTrack();
  }

  function zoomTrack(ratio) {
    zoom = Math.max(1, Math.min(32, zoom * ratio));
    renderTrack();
    inView(cursor);
  }

  function noteTimeField(note, key, label) {
    const input = element("input", {
      type: "number", min: 0, max: duration(), step: 0.001, value: note[key] ?? "", "aria-label": label,
    });
    input.addEventListener("change", () => {
      const value = input.value === "" ? null : input.valueAsNumber;
      const start = key === "start" ? value : note.start;
      const end = key === "end" ? value : note.end;
      if (start == null || !input.validity.valid || (end != null && end <= start)) {
        toast("请输入原片范围内的时间，终点要晚于起点。");
        input.value = note[key] ?? "";
        return;
      }
      note[key] = value == null ? null : round(value);
      setCursor(note.start);
      inView(note.start);
      renderMarkers();
      showInspector();
      changed();
    });
    return element("label", {}, label, input);
  }

  function showInspector() {
    if (!asset) return;
    sourceInspector = true;
    cards.get(selectedId)?.classList.remove("selected");
    const note = notes(asset).find((item) => item.id === noteId);
    const scene = board.scenes.find((item) => item.id === note?.sceneId);
    const title = element("h2", { title: asset.name }, asset.name);
    const top = element("div", { cls: "inspector-top" },
      element("span", { cls: "section-label" }, "原素材 / 时间批注"),
      button("返回分镜", () => select(selectedId), { cls: "back-to-shots" }));
    const entries = ordered(asset).map((item) => {
      const row = button("", () => selectNote(item, true), {
        cls: "annotation-row", "aria-current": item === note, title: item.title,
      });
      row.append(element("span", {}, timeLabel(item)), element("strong", {}, item.title));
      return row;
    });
    const list = element("div", { cls: "annotation-list" }, ...entries);
    const scroll = inspector.scrollTop;
    const extra = [];
    if (note) {
      const input = element("input", { id: "annotation-title", value: note.title, maxlength: 120 });
      input.addEventListener("input", () => {
        note.title = input.value.trim() || "新批注";
        renderMarkers();
        list.querySelector('[aria-current="true"] strong').textContent = note.title;
        changed();
      });
      const comment = element("textarea", { rows: 4, value: note.comment, placeholder: "例如：保留完整鼠标越屏动作，点击后停一拍。" });
      comment.addEventListener("input", () => { note.comment = comment.value; changed(); });
      const remove = button("删除标注", () => {
        asset.annotations = notes(asset).filter((item) => item !== note);
        if (scene) {
          updateShotBadge(scene);
          renderOutline();
        }
        noteId = undefined;
        updateCard(asset);
        renderMarkers();
        showInspector();
        changed();
      }, { cls: "remove-annotation" });
      extra.push(element("div", { cls: "annotation-edit" },
        element("label", { cls: "field" }, element("span", {}, "内容点"), input),
        element("div", { cls: "annotation-times" }, noteTimeField(note, "start", "起点（秒）"), noteTimeField(note, "end", "终点（秒，可留空）")),
        ...(scene ? [element("div", { cls: "linked-script" }, element("b", {}, "分镜 " + scene.id + " · " + scene.title), element("p", {}, scene.text))] : []),
        element("label", { cls: "field" }, element("span", {}, "批注"), comment), remove));
    } else {
      extra.push(element("p", { cls: "source-empty" }, "在刻度上拖动播放头，或用「框选时段」选出一段。把左侧分镜拖进去，或点「＋ 批注」记录剪辑要求。"));
    }
    inspector.replaceChildren(top, title, ...extra,
      element("h3", { cls: "annotation-list-title" }, "标注列表 · " + entries.length),
      list);
    inspector.scrollTop = scroll;
  }

  function appendExport(lines) {
    if (!board.assets.some((item) => notes(item).length)) return;
    lines.push("## 原素材时间轴标注", "", "按原片时间排序。单个时间为关键点，两个时间为源片区间。", "");
    for (const item of board.assets.filter((entry) => notes(entry).length)) {
      lines.push("### " + item.name, "", "源文件 " + item.file, "");
      for (const note of ordered(item)) {
        const scene = board.scenes.find((candidate) => candidate.id === note.sceneId);
        lines.push("- " + timeLabel(note) + " ｜ " + note.title + (scene ? " ｜ 分镜 " + scene.id : ""));
        if (scene) lines.push("  - 口播 " + scene.text.trim());
        if (note.comment) lines.push("  - 批注 " + note.comment.trim().replace(/\r?\n/g, "\n    "));
      }
      lines.push("");
    }
  }

  function init() {
    board.assets.forEach(addCard);
    let measured = 0;
    new ResizeObserver(() => {
      const width = scroller?.clientWidth ?? 0;
      if (asset && width && width !== measured) renderTrack();
      measured = width;
    }).observe(dock);
  }

  return {
    init, addCard, open, position, makeDraggable, sceneDrag, appendExport, references,
    inspecting: () => sourceInspector,
    leaveInspector: () => { sourceInspector = false; },
    activePosition: () => sourceInspector && asset ? position(asset) : null,
  };
})();
