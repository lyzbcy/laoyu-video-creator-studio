const fs = require("node:fs");
const path = require("node:path");
const {randomBytes} = require("node:crypto");

const kinds = new Set(["music", "sfx", "ambient"]);
const safeName = value => typeof value === "string" && value.trim() && value.length <= 240 &&
  !/[\u0000-\u001f/\\]/.test(value) && !Object.hasOwn(Object.prototype, value);
const fail = (status, message) => Object.assign(new Error(message), {status});

function readConfig(data) {
  const file = path.join(data,"legacy-bgm.json");
  if (!fs.existsSync(file) || fs.statSync(file).size > 32768) return null;
  const config = JSON.parse(fs.readFileSync(file,"utf8").replace(/^\uFEFF/,""));
  if (typeof config.library !== "string" || !path.isAbsolute(config.library) || !/\.jsonl$/i.test(config.library)) return null;
  return config;
}

function readLibraryFile(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.size > 4*1024*1024) throw fail(422,"旧标签库格式或大小不受支持。");
  return fs.readFileSync(file);
}

function normalizeRecord(row) {
  if (!safeName(row?.id)) return null;
  const tags = Object.fromEntries(Object.entries(row.tags || {}).filter(([name,values]) => safeName(name) && Array.isArray(values))
    .map(([name,values]) => [name,values.filter(safeName)]));
  const record = {id:row.id,file:safeName(row.file)?row.file:row.id,kind:kinds.has(row.kind)?row.kind:"music",
    duration:Number.isFinite(row.duration)&&row.duration>0?row.duration:null,tags,note:typeof row.note==="string"?row.note:""};
  for (const key of ["source_id","labeled_at","updated_at","excluded_at","kindSource"]) {
    if (safeName(row[key])) record[key]=row[key];
  }
  if (row.excluded===true) record.excluded=true;
  return record;
}

function parseLibrary(buffer, strict=false) {
  const records = new Map(), groups = new Map(), lines = [];
  const addGroup = (name,tags) => {
    if (!safeName(name) || !Array.isArray(tags)) return;
    if (!groups.has(name)) groups.set(name,new Set());
    for (const tag of tags) if (safeName(tag)) groups.get(name).add(tag);
  };
  for (const text of buffer.toString("utf8").replace(/^\uFEFF/,"").split(/\r?\n/)) {
    if (!text.trim()) continue;
    let row;
    try { row=JSON.parse(text); }
    catch {
      if (strict) throw fail(422,"旧标签库含无法识别的行，已停止写入。");
      continue;
    }
    lines.push(row);
    if (row?._meta === "schema" && Array.isArray(row.groups)) {
      for (const group of row.groups) addGroup(group?.name,group?.tags);
    } else {
      const record=normalizeRecord(row);
      if (!record) continue;
      if (strict && records.has(record.id)) throw fail(422,"旧标签库含重复 ID，已停止写入。");
      for (const [name,values] of Object.entries(record.tags)) addGroup(name,values);
      records.set(record.id,record);
    }
  }
  return {records,groups:[...groups].map(([name,tags])=>({name,tags:[...tags]})),lines};
}

function readLegacyLibrary(data) {
  let config;
  try {
    config=readConfig(data);
    if (!config) return null;
    const {records,groups}=parseLibrary(readLibraryFile(config.library));
    const byName = new Map();
    const addName = (key,id) => {
      key=key.toLowerCase();
      if (!byName.has(key)) byName.set(key,id);
      else if (byName.get(key)!==id) byName.set(key,null);
    };
    for (const row of records.values()) {
      addName(row.file,row.id);
      for (const key of new Set([row.id,row.source_id])) if (/^[a-f0-9]{32}$/i.test(key || "")) {
        addName(key,row.id);
        addName(key.slice(0,8),row.id);
      }
    }
    const dirs = Array.isArray(config.audioDirs)?config.audioDirs.filter(dir=>typeof dir==="string"&&path.isAbsolute(dir)).map(dir=>path.resolve(dir)):[];
    return {
      summary:{records:[...records.values()],groups,managed:config.writeEnabled===true,name:path.basename(config.library)},
      dirs:[...new Set(dirs)],
      match(file) {
        const stem=path.basename(file,path.extname(file)).toLowerCase();
        const token=/(?:^|_)([a-f0-9]{32}|[a-f0-9]{8})$/i.exec(stem)?.[1];
        const name=file.toLowerCase();
        return (byName.has(name)?byName.get(name):token&&byName.get(token)) || undefined;
      },
    };
  } catch { return config?{summary:{unavailable:true,managed:config.writeEnabled===true},dirs:[],match:()=>undefined}:null; }
}

function replaceFile(file, bytes, beforeRename) {
  const temp=file+"."+randomBytes(8).toString("hex")+".tmp";
  try {
    fs.writeFileSync(temp,bytes,{flag:"wx"});
    beforeRename?.();
    fs.renameSync(temp,file);
  } finally { try { fs.unlinkSync(temp); } catch {} }
}

function saveLegacyDatabase(data, input) {
  const config=readConfig(data);
  if (config?.writeEnabled!==true) throw fail(403,"旧标签库未绑定为可写数据库。");
  if (!Array.isArray(input?.changes) || input.changes.length>5000) throw fail(400,"保存记录格式无效。");
  const original=readLibraryFile(config.library);
  const {records,groups,lines}=parseLibrary(original,true);
  const updates=new Map();
  const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  for (const change of input.changes) {
    const id=change?.id;
    if (!safeName(id) || updates.has(id)) throw fail(400,"保存记录 ID 无效或重复。");
    if (!equal(change.before,records.get(id)||null)) throw fail(409,"同一条标签已在另一处改动，数据库保留原样。当前修改已留在本机。");
    const next=normalizeRecord(change.record);
    if (change.record!==null && next?.id!==id) throw fail(400,"保存记录格式无效。");
    updates.set(id,next);
  }
  if (input.groups && (!Array.isArray(input.groups.after) || input.groups.after.some(group=>
      !safeName(group?.name)||!Array.isArray(group.tags)||!group.tags.every(safeName)))) throw fail(400,"标签组格式无效。");
  if (input.groups && !equal(input.groups.before,groups)) throw fail(409,"标签组已在另一处改动，数据库保留原样。当前修改已留在本机。");
  if (!updates.size && !input.groups) return {records:[],groups};

  const remaining=new Map(updates);
  let hasMeta=false;
  const merged=lines.flatMap(row=>{
    if (row?._meta==="schema" && input.groups && !hasMeta) {
      hasMeta=true;
      return [{...row,groups:input.groups.after}];
    }
    if (!remaining.has(row?.id)) return [row];
    const next=remaining.get(row.id);
    remaining.delete(row.id);
    if (!next) return [];
    const preserved={...row,...next};
    for (const key of ["excluded","excluded_at"]) if (!Object.hasOwn(next,key)) delete preserved[key];
    return [preserved];
  });
  if (input.groups && !hasMeta) merged.unshift({_meta:"schema",version:2,app:"捞鱼打标工具",groups:input.groups.after});
  for (const record of remaining.values()) if (record) merged.push(record);
  const next=Buffer.from(merged.map(row=>JSON.stringify(row)).join("\n")+"\n");
  if (next.length>4*1024*1024) throw fail(422,"保存后的数据库超出大小限制。");
  replaceFile(path.join(data,"legacy-bgm.previous.jsonl"),original);
  replaceFile(config.library,next,()=>{
    if (!readLibraryFile(config.library).equals(original)) throw fail(409,"数据库刚被外部更新，当前修改已留在本机。");
  });
  const saved=parseLibrary(next,true);
  return {records:[...updates.keys()].map(id=>({id,record:saved.records.get(id)||null})),groups:saved.groups};
}

module.exports = {readLegacyLibrary,saveLegacyDatabase};
