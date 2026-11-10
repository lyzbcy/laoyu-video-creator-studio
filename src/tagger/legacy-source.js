const fs = require("node:fs");
const path = require("node:path");

const kinds = new Set(["music", "sfx", "ambient"]);
const safeName = value => typeof value === "string" && value.trim() && value.length <= 240 &&
  !/[\u0000-\u001f/\\]/.test(value) && !Object.hasOwn(Object.prototype, value);

function readLegacyLibrary(data) {
  let configured = false;
  try {
    const location = path.join(data, "legacy-bgm.json");
    if (fs.statSync(location).size > 16384) return null;
    const config = JSON.parse(fs.readFileSync(location,"utf8").replace(/^\uFEFF/,""));
    if (typeof config.library !== "string" || !path.isAbsolute(config.library) || !/\.jsonl$/i.test(config.library)) return null;
    configured = true;
    const stat = fs.statSync(config.library);
    if (!stat.isFile() || stat.size > 4*1024*1024) throw new Error("invalid library");
    const records = new Map();
    const groups = new Map();
    const addGroup = (name,tags) => {
      if (!safeName(name) || !Array.isArray(tags)) return;
      if (!groups.has(name)) groups.set(name,new Set());
      for (const tag of tags) if (safeName(tag)) groups.get(name).add(tag);
    };
    for (const line of fs.readFileSync(config.library,"utf8").replace(/^\uFEFF/,"").split(/\r?\n/)) {
      if (!line.trim()) continue;
      let row;
      try { row = JSON.parse(line); } catch { continue; }
      if (row?._meta === "schema" && Array.isArray(row.groups)) {
        for (const group of row.groups) addGroup(group?.name,group?.tags);
        continue;
      }
      if (!safeName(row?.id)) continue;
      const tags = Object.fromEntries(Object.entries(row.tags || {}).filter(([name,values]) => safeName(name) && Array.isArray(values))
        .map(([name,values]) => [name,values.filter(safeName)]));
      for (const [name,values] of Object.entries(tags)) addGroup(name,values);
      const record = {id:row.id,file:safeName(row.file)?row.file:row.id,kind:kinds.has(row.kind)?row.kind:"music",
        duration:Number.isFinite(row.duration)&&row.duration>0?row.duration:null,tags,note:typeof row.note==="string"?row.note:""};
      for (const key of ["source_id","labeled_at","updated_at","excluded_at","kindSource"]) {
        if (safeName(row[key])) record[key]=row[key];
      }
      if (row.excluded===true) record.excluded=true;
      records.set(record.id,record);
    }
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
      summary:{records:[...records.values()],groups:[...groups].map(([name,tags])=>({name,tags:[...tags]}))},
      dirs:[...new Set(dirs)],
      match(file) {
        const stem=path.basename(file,path.extname(file)).toLowerCase();
        const token=/(?:^|_)([a-f0-9]{32}|[a-f0-9]{8})$/i.exec(stem)?.[1];
        const name=file.toLowerCase();
        return (byName.has(name)?byName.get(name):token&&byName.get(token)) || undefined;
      },
    };
  } catch { return configured?{summary:{unavailable:true},dirs:[],match:()=>undefined}:null; }
}

module.exports = {readLegacyLibrary};
