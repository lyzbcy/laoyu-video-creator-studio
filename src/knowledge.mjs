import { createHash } from "node:crypto";

const text = (value, size) => typeof value === "string" ? value.trim().slice(0, size) : "";
const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
const hash = value => createHash("sha256").update(value).digest("hex");

export function libraryRows(input) {
  if (typeof input === "string") {
    try { input = input.replace(/^\uFEFF/, "").split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line)); }
    catch { fail("无法读取打标库 JSONL。"); }
  }
  if (!Array.isArray(input) || input.length > 5000) fail("打标库格式无效或超过 5000 条。");
  const tracks = new Map();
  for (const row of input) {
    if (!row || typeof row !== "object" || row._meta || row.excluded) continue;
    const source = text(row.source_id || row.id, 200);
    const title = text(row.title || row.file, 200).split(/[/\\]/).at(-1);
    if (!source || !title || !["music", "sfx", "ambient"].includes(row.kind)) continue;
    const tags = Object.entries(row.tags || {}).slice(0, 24).flatMap(([group, values]) =>
      Array.isArray(values) ? values.slice(0, 24).map(value => ({ group: text(group, 60), label: text(value, 60) })) : [])
      .filter(tag => tag.group && tag.label);
    const note = text(row.note, 1200);
    if (!tags.length && !note) continue;
    const id = hash(source).slice(0, 24);
    tracks.set(id, { id, title, kind: row.kind, duration: Number.isFinite(row.duration) ? row.duration : null, tags, note });
  }
  return [...tracks.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function sourceGraph(sources, prior) {
  const rows = Object.keys(sources).sort((a,b)=>{
    const rank=key=>key==="tagger"?2:key==="file"?1:0;
    return rank(a)-rank(b)||a.localeCompare(b);
  }).flatMap(key => sources[key]);
  const tracks = [...new Map(rows.map(track => [track.id, track])).values()].sort((a,b)=>a.id.localeCompare(b.id));
  const revision = hash(JSON.stringify(tracks));
  const tags = new Map();
  for (const track of tracks) for (const tag of track.tags) {
    const key = tag.group + " / " + tag.label;
    if (!tags.has(key)) tags.set(key, { ...tag, key, tracks: [] });
    const list = tags.get(key).tracks;
    if (!list.includes(track.id)) list.push(track.id);
  }
  return { schema: 1, revision, tracks, tags: [...tags.values()].sort((a,b) => b.tracks.length-a.tracks.length || a.key.localeCompare(b.key)),
    insights: prior?.revision === revision ? prior.insights : [], outdated: Boolean(prior && prior.revision !== revision) };
}

export function validateInsights(candidate, graph) {
  if (candidate?.schema !== 1 || candidate.revision !== graph.revision) fail("标签库已变化，请重新导出当前图谱交给 Agent。");
  if (!Array.isArray(candidate.insights) || !candidate.insights.length || candidate.insights.length > 120) fail("建议需包含 1 到 120 条规则。");
  const tracks = new Map(graph.tracks.map(track => [track.id, track]));
  return candidate.insights.map(rule => {
    const scene = text(rule?.scene, 90);
    const reason = text(rule?.reason, 380);
    const cue = text(rule?.cue, 120);
    const kind = rule?.kind;
    const evidence = Array.isArray(rule?.evidence) ? rule.evidence : [];
    if (!scene || !reason || !["适合", "慎用", "搭配"].includes(kind) || !evidence.length || evidence.length > 8) fail("建议必须包含场景、关系、理由和曲目证据。");
    const verified = evidence.map(item => {
      const track = tracks.get(item?.track);
      if (!track || typeof item.quote !== "string" || !item.quote.trim() || item.quote.length > 160 ||
        ![track.note, ...track.tags.map(tag => tag.label)].some(source => source.includes(item.quote))) fail("有引用找不到对应曲目或原始标签、备注。");
      return { track: track.id, quote: item.quote };
    });
    if (kind === "搭配" && new Set(verified.map(item=>item.track)).size < 2) fail("搭配建议至少需要两首不同曲目的证据。");
    return { scene, kind, cue, reason, evidence: verified };
  });
}
