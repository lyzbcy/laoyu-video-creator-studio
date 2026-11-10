export const kinds = ["video", "audio", "caption"];
export const labels = { video:"画面", audio:"BGM", caption:"字幕" };
const maxTime = 24 * 60 * 60 * 1000;
const integer = n => Number.isSafeInteger(n) && n >= 0 && n <= maxTime;
const fail = message => { throw new Error(message); };
const title = (v, limit) => typeof v === "string" && v.length <= limit;
const idOk = v => typeof v === "string" && /^[a-zA-Z0-9_-]{1,90}$/.test(v);
export const newId = () => crypto.randomUUID();
export const endOf = clip => clip.at + clip.length;
export const durationOf = clips => Math.max(0, ...clips.map(endOf));
export const sourceKind = asset => asset.mime?.startsWith("audio/") ? "audio" : asset.mime?.startsWith("image/") ? "image" : "video";

export function validateClips(clips, assets) {
  if (!Array.isArray(clips) || clips.length > 1500) fail("片段数量或结构无效。");
  const media = new Map(assets.map(asset => [asset.id, asset]));
  const seen = new Set();
  for (const c of clips) {
    if (!c || !idOk(c.id) || seen.has(c.id) || !kinds.includes(c.kind) || !Number.isInteger(c.lane) ||
        c.lane < 0 || c.lane > 11 || !integer(c.at) || !integer(c.length) || c.length === 0 || !integer(endOf(c)) ||
        !integer(c.from) || !title(c.label, 160) || !title(c.text, 12000) || typeof c.locked !== "boolean" ||
        !Number.isFinite(c.volume) || c.volume < 0 || c.volume > 1) fail("有片段的时间、轨道或属性无效。");
    seen.add(c.id);
    if (c.kind === "caption") {
      if (c.asset !== null || !c.text.trim()) fail("字幕轨需要可读文字。");
    } else {
      const a = media.get(c.asset);
      if (!a || (c.kind === "audio") !== (sourceKind(a) === "audio")) fail("素材缺失或轨道类型不匹配。");
      if (sourceKind(a) !== "image" && a.duration && c.from + c.length > Math.round(a.duration * 1000) + 1) fail("片段超出原片长度。");
    }
  }
  const ends = new Map();
  for (const c of [...clips].sort((a,b) => a.at - b.at)) {
    const key = c.kind + c.lane;
    if ((ends.get(key) ?? 0) > c.at) fail("同一轨道的片段不能重叠。请移动片段或换到空轨。");
    ends.set(key, endOf(c));
  }
  return clips;
}

export function makeClip(kind, fields = {}) {
  return { id:newId(), kind, lane:0, at:0, length:3000, from:0, asset:null,
    label:"", text:"", volume:1, locked:false, ...fields };
}

export function splitClip(clips, id, at, assets) {
  const c=clips.find(item=>item.id===id);
  if (!c || c.locked || !Number.isSafeInteger(at) || at<=c.at || at>=endOf(c)) fail("请把播放头放在未锁定片段内部。");
  const length=at-c.at;
  const right={...c,id:newId(),at,length:c.length-length,from:c.kind==="caption"?0:c.from+length};
  return validateClips(clips.flatMap(item=>item===c ? [{...c,length},right] : [item]),assets);
}

export function roughCut(board) {
  let at=0;
  const clips=[];
  const media=new Map(board.assets.map(asset=>[asset.id,asset]));
  for (const scene of board.scenes) {
    const explicit=scene.clips.map(c=>({ asset:media.get(c.assetId), start:c.in, end:c.out }));
    const marks=board.assets.flatMap(asset=>(asset.annotations??[]).filter(n=>n.sceneId===scene.id)
      .map(n=>({asset,start:n.start,end:n.end})));
    const inputs=explicit.length ? explicit : marks;
    const begin=at;
    for (const {asset,start,end} of inputs) {
      if (!asset) continue;
      const limit=asset.duration || (sourceKind(asset)==="image"?3:null);
      if (limit===null && end==null) continue;
      const from=Math.round((start||0)*1000);
      const to=Math.round(Math.min(end ?? (start==null?limit:(start+3)),limit??Infinity)*1000);
      if (!Number.isSafeInteger(to) || to<=from) continue;
      const kind=sourceKind(asset)==="audio"?"audio":"video";
      clips.push(makeClip(kind,{asset:asset.id,label:scene.title,at,from,length:to-from}));
      at+=to-from;
    }
    if (at>begin && scene.text.trim()) clips.push(makeClip("caption",{at:begin,length:at-begin,label:"口播",text:scene.text}));
  }
  if (!clips.length) fail("没有可组接的片段。请先给分镜绑定有起止时间的素材，或在原片上拖入口播。");
  return validateClips(clips,board.assets);
}

const inRange=(c, range)=>!range || (c.at>=range.start && endOf(c)<=range.end);
const allowedFields=new Set(["at","from","length","lane","label","text","volume","asset"]);
export function applyOperations(base, operations, assets, range) {
  if (!Array.isArray(operations) || operations.length===0 || operations.length>1500) fail("修改清单为空或结构无效。");
  if (range && (!integer(range.start) || !integer(range.end) || range.start>=range.end)) fail("修改范围无效。");
  const clips=new Map(base.map(c=>[c.id,c]));
  for (const op of operations) {
    if (!op || !["update","remove","add"].includes(op.type)) fail("未知的修改类型。");
    if (op.type==="add") {
      const c=op.clip;
      if (!c || clips.has(c.id) || !inRange(c,range) || c.locked) fail("新增片段超出范围或与现有片段冲突。");
      clips.set(c.id,c);
      continue;
    }
    const c=clips.get(op.id);
    if (!c || c.locked || !inRange(c,range)) fail("修改触及锁定、缺失或选区外片段。");
    if (op.type==="remove") { clips.delete(c.id); continue; }
    if (!op.fields || Object.keys(op.fields).some(k=>!allowedFields.has(k))) fail("修改字段无效。");
    const next={...c,...op.fields};
    if (!inRange(next,range)) fail("修改后的片段超出选区。");
    clips.set(c.id,next);
  }
  return validateClips([...clips.values()],assets);
}

export function parseDraft(draft, assets, resolveAsset) {
  if (!draft || !Array.isArray(draft.tracks) || !draft.materials) fail("无法识别这个剪映明文草稿。加密格式需兼容适配器。");
  const clips=[], warnings=[];
  const media=new Map(["videos","audios","texts"].flatMap(group=>(draft.materials[group]??[]).map(item=>[item.id,item])));
  const lanes={video:0,audio:0,caption:0};
  for (const track of draft.tracks) {
    const kind={video:"video",audio:"audio",text:"caption"}[track.type];
    if (!kind) { warnings.push("未映射轨道 "+track.type); continue; }
    const lane=lanes[kind]++;
    for (const segment of track.segments??[]) {
      const material=media.get(segment.material_id);
      const time=segment.target_timerange;
      if (!material || !time || lane>11 || (segment.speed && segment.speed!==1)) {
        warnings.push("跳过缺素材、变速或超出轨数的片段");
        continue;
      }
      const at=Math.round(time.start/1000), length=Math.round(time.duration/1000);
      if (length<=0 || !integer(at) || !integer(length)) { warnings.push("跳过无效时间段");continue; }
      if (kind==="caption") {
        let text=material.content??"";
        try { text=JSON.parse(text).text??text; } catch {}
        if (typeof text==="string" && text.trim()) clips.push(makeClip(kind,{lane,at,length,text,label:"剪映字幕"}));
        else warnings.push("未读取一条字幕");
      } else {
        const asset=resolveAsset(material);
        if (!asset) { warnings.push("缺素材 "+(material.material_name??material.name??"未命名"));continue; }
        clips.push(makeClip(kind,{asset:asset.id,at,length,lane,label:asset.name.slice(0,160),
          from:Math.round((segment.source_timerange?.start??0)/1000),volume:Math.min(1,Math.max(0,segment.volume??1))}));
      }
    }
  }
  if (!clips.length) fail("草稿没有可导入的片段。请核对草稿格式和已导入的源文件。");
  warnings.push("花字、特效、转场、变速、关键帧及云资源按当前基础格式不还原。");
  return {clips:validateClips(clips,assets),warnings:[...new Set(warnings)]};
}