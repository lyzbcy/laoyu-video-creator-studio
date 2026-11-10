const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const {createHash, randomBytes} = require("node:crypto");
const {execFile} = require("node:child_process");
const {promisify} = require("node:util");
const run = promisify(execFile);
const idPattern = /^[a-f0-9]{32}$/i;
const candidate = /^(?:draft_content\.json|draft_info\.json|key_value\.json|template\.json(?:\.bak)?)$/i;

function titleLookup(fallback, snapshot) {
  const index=new Map();
  for (const [id,entry] of Object.entries(fallback||{})) {
    if (idPattern.test(id) && typeof entry?.title==="string" && entry.title.trim() &&
        !/^[a-f0-9]{16,}(?:\.[a-z0-9]+)?$|^(未命名项目|音乐|背景音乐|音频|bgm|audio)$/i.test(entry.title.trim())) {
      index.set(id.toLowerCase(),{title:entry.title.trim(),author:entry.author||undefined,vip:entry.vip==="1"||undefined,
        mid:entry.mid||undefined,titleSource:"jianying-draft"});
    }
  }
  for (const [id,title] of Object.entries(snapshot?.titles||{})) {
    if (idPattern.test(id) && typeof title==="string" && title) index.set(id,{...index.get(id),title,titleSource:snapshot.titleSources?.[id]==="jianying-catalog"?"jianying-catalog":"jianying-draft"});
  }
  for (const id of snapshot?.conflicts||[]) index.delete(id);
  return {find(...names) {
    for (const value of names) if (typeof value==="string" && idPattern.test(value) && index.has(value.toLowerCase())) return index.get(value.toLowerCase());
    // A short export suffix alone is not sufficient to identify a track.
    return undefined;
  }};
}

async function filesFor(roots) {
  const found=[];
  let visited=0;
  async function walk(dir,depth) {
    if (depth>7 || ++visited>3500) return;
    const entries=await fs.readdir(dir,{withFileTypes:true}).catch(()=>[]);
    for (const entry of entries) {
      const full=path.join(dir,entry.name);
      if (entry.isDirectory() && !/^\.(?:recycle_bin|git)/i.test(entry.name)) await walk(full,depth+1);
      else if (entry.isFile() && candidate.test(entry.name)) {
        const stat=await fs.stat(full).catch(()=>null);
        if (stat?.size>0 && stat.size<=8*1024*1024) found.push({full,size:stat.size,mtime:stat.mtimeMs});
      }
    }
  }
  for (const root of new Set(roots)) if (typeof root==="string" && path.isAbsolute(root)) await walk(root,0);
  return found.sort((a,b)=>b.mtime-a.mtime||a.full.localeCompare(b.full)).slice(0,300);
}

async function cacheInputs(userData) {
  const cache=path.join(userData,"Cache");
  const index=path.join(cache,"music","downLoadcfg");
  const catalogRoot=path.join(cache,"ressdk_db");
  const entries=await fs.readdir(catalogRoot,{withFileTypes:true}).catch(()=>[]);
  const catalogs=[];
  const stamps=[];
  async function stat(file) {
    const entry=await fs.stat(file).catch(()=>null);
    if (!entry?.isFile()) return false;
    stamps.push([file,entry.size,entry.mtimeMs]);
    return true;
  }
  const cacheIndex=await stat(index)?index:null;
  if (cacheIndex) for (const dir of entries.filter(entry=>entry.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name)).slice(0,20)) {
    const file=path.join(catalogRoot,dir.name,"rp.db");
    if (await stat(file)) {catalogs.push(file);await stat(file+"-wal");}
  }
  return {cacheIndex,catalogs,stamps};
}

function createDraftTitles(data,onChange) {
  const file=path.join(data,"bgm-title-index.json");
  let current=null, initialized=false, running=null, autoAt=0;
  async function load() {
    if (!initialized) {
      initialized=true;
      try {
        const cached=JSON.parse(await fs.readFile(file,"utf8"));
        if (cached.schema===1) {current=cached;onChange();}
      } catch {}
    }
  }
  async function scan() {
    await load();
    if (process.platform!=="win32" || process.env.LAOYU_STUDIO_DISABLE_DISCOVERY==="1") return {configured:false};
    const config=await fs.readFile(path.join(data,"draft-titles.json"),"utf8").then(value=>JSON.parse(value.replace(/^\uFEFF/,"")),()=>null);
    if (!config || ![config.python,config.install].every(p=>typeof p==="string"&&path.isAbsolute(p)) || !/^[a-f0-9]{64}$/.test(config.dllSha256||"")) return {configured:false};
    const userData=path.join(process.env.LOCALAPPDATA||"","JianyingPro","User Data");
    const defaultRoot=path.join(userData,"Projects");
    const files=await filesFor([defaultRoot,...(Array.isArray(config.roots)?config.roots:[])]);
    const {cacheIndex,catalogs,stamps}=await cacheInputs(userData);
    const fingerprint=createHash("sha256").update(JSON.stringify([config.dllSha256,files,stamps])).digest("hex");
    if (current?.fingerprint===fingerprint) return {configured:true,drafts:current.draftsRead,titles:Object.keys(current.titles).length};
    if (!files.length && !cacheIndex) return {configured:true,drafts:0,titles:0};
    const temp=await fs.mkdtemp(path.join(os.tmpdir(),"laoyu-bgm-titles-"));
    const request=path.join(temp,"request.json"), output=path.join(temp,"index.json");
    try {
      await fs.writeFile(request,JSON.stringify({install:config.install,dllSha256:config.dllSha256,files:files.map(file=>file.full),cacheIndex,catalogs}));
      await run(config.python,["-I","-B",path.join(__dirname,"read-draft-titles.py"),request,output],
        {cwd:temp,windowsHide:true,timeout:60000,maxBuffer:512*1024});
      const index=JSON.parse(await fs.readFile(output,"utf8"));
      if (!index.draftsRead && !Object.keys(index.titles).length) throw new Error("No supported title sources");
      const titles={...current?.titles}, titleSources={...current?.titleSources};
      for (const [id,title] of Object.entries(index.titles)) {
        if (index.titleSources?.[id]==="jianying-catalog") titleSources[id]="jianying-catalog";
        else if (titleSources[id]==="jianying-catalog") continue;
        titles[id]=title;
      }
      const conflicts=index.conflicts.filter(id=>titleSources[id]!=="jianying-catalog");
      for (const id of conflicts) delete titles[id];
      const updated={schema:1,fingerprint,draftsRead:index.draftsRead,titles,titleSources,conflicts};
      const pending=file+"."+randomBytes(8).toString("hex")+".tmp";
      try {await fs.writeFile(pending,JSON.stringify(updated),{flag:"wx"});await fs.rename(pending,file);}
      finally {await fs.unlink(pending).catch(()=>{});}
      current=updated;
      onChange();
      return {configured:true,drafts:updated.draftsRead,titles:Object.keys(updated.titles).length};
    } catch {
      throw Object.assign(new Error("未能完成本机草稿索引，已保留之前确认的曲名。"),{status:502});
    } finally {
      await Promise.all([request,output].map(item=>fs.unlink(item).catch(()=>{})));
      await fs.rmdir(temp).catch(()=>{});
    }
  }
  function refresh() {
    if (!running) running=scan().finally(()=>{running=null;});
    return running;
  }
  return {refresh,current:()=>current,auto() {
    if (Date.now()-autoAt<300000) return;
    autoAt=Date.now();
    void refresh().catch(()=>{});
  }};
}
module.exports={createDraftTitles,titleLookup};
