import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomBytes, createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { categories, createFeedback, feedbackLog } from "./feedback.mjs";
import { createDiagnostics } from "./diagnostics.mjs";
import { createMarketplace, validateEntry } from "./market.mjs";
import { libraryRows, sourceGraph, validateInsights } from "./knowledge.mjs";
import { validateClips } from "./public/timeline.mjs";

export const version=JSON.parse(fs.readFileSync(new URL("../package.json",import.meta.url),"utf8")).version;
const root=path.dirname(fileURLToPath(import.meta.url));
const web=path.join(root,"public");
const data=path.resolve(process.env.LAOYU_STUDIO_DATA || path.join(process.env.LOCALAPPDATA || os.homedir(),"LaoyuCreatorStudio"));
const projects=path.join(data,"projects");

const knowledgeFile=path.join(data,"bgm-knowledge.json");
const official=read(new URL("./market-catalog.json",import.meta.url)).entries;
const knowledge=()=>fs.existsSync(knowledgeFile)?read(knowledgeFile):{sources:{},curation:null};
const token=randomBytes(24).toString("hex");
const pidPattern=/^[a-f0-9]{32}$/;
const mediaPattern=/^[a-f0-9]{32}\.[a-z0-9]{2,5}$/;
const id=()=>randomBytes(16).toString("hex");
const type={
  ".mp4":"video/mp4",".m4v":"video/mp4",".mov":"video/quicktime",".webm":"video/webm",
  ".mkv":"video/x-matroska",".avi":"video/x-msvideo",".mp3":"audio/mpeg",".m4a":"audio/mp4",
  ".wav":"audio/wav",".aac":"audio/aac",".ogg":"audio/ogg",".flac":"audio/flac",
  ".jpg":"image/jpeg",".jpeg":"image/jpeg",".png":"image/png",".webp":"image/webp",".gif":"image/gif",".avif":"image/avif"
};
const publicFiles=new Map([
  ["/","index.html"],["/board.html","board.html"],["/studio.css","studio.css"],["/studio.mjs","studio.mjs"],
  ["/editor.mjs","editor.mjs"],["/timeline.mjs","timeline.mjs"],["/board.js","board.js"],
  ["/source-board.js","source-board.js"],["/board.css","board.css"],["/board-theme.css","board-theme.css"],
  ["/tagger-theme.css","tagger-theme.css"],["/logo.png","logo.png"],["/agent-ui.mjs","agent-ui.mjs"]
]);

function err(status,message) { return Object.assign(new Error(message),{status}); }
function reply(res,status,body) {
  res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});
  res.end(JSON.stringify(body));
}
function read(filename) { return JSON.parse(fs.readFileSync(filename,"utf8")); }
function write(filename,value) {
  const temp=filename+"."+id()+".tmp";
  try {
    fs.writeFileSync(temp,JSON.stringify(value,null,2)+"\n",{flag:"wx"});
    fs.renameSync(temp,filename);
  } finally { try{fs.unlinkSync(temp);}catch{} }
}
function saveKnowledgeSource(key,tracks) {
  const state=knowledge();
  state.sources[key]=tracks;
  const size=Object.values(state.sources).reduce((sum,rows)=>sum+rows.length,0);
  if (size>8000) throw err(400,"图谱累计最多支持 8000 条标签记录。");
  write(knowledgeFile,state);
  return sourceGraph(state.sources,state.curation);
}

async function body(req, max=16*1024*1024) {
  const len=Number(req.headers["content-length"] || 0);
  if (len>max) throw err(413,"内容过大。");
  let size=0;
  const chunks=[];
  for await (const chunk of req) {
    size+=chunk.length;
    if (size>max) throw err(413,"内容过大。");
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8").replace(/^\uFEFF/,"")); }
  catch { throw err(400,"JSON 无效。"); }
}
function validBoard(b) {
  if (!b || b.version!==1 || typeof b.title!=="string" || !b.title.trim() || b.title.length>140 ||
      !Array.isArray(b.scenes) || !b.scenes.length || b.scenes.length>600 || !Array.isArray(b.chapters) ||
      !b.chapters.length || !Array.isArray(b.assets) || b.assets.length>2500) throw err(400,"画布格式或数量不支持。");
  let total=0;
  for (const c of b.chapters) {
    if (!c || typeof c.name!=="string" || typeof c.label!=="string" || !Number.isInteger(c.count) || c.count<0) throw err(400,"画布章节无效。");
    total+=c.count;
  }
  if (total!==b.scenes.length) throw err(400,"分镜数量与章节不一致。");
  const ids=new Set(), media=new Set();
  for (const a of b.assets) {
    if (!a || !pidPattern.test(a.id) || media.has(a.id) || !mediaPattern.test(a.file?.split("/").at(-1)) ||
        a.file?.split("/").at(-1).split(".")[0]!==a.id || typeof a.name!=="string" ||
        !type[path.extname(a.file)] || (a.annotations!==undefined && !Array.isArray(a.annotations))) throw err(400,"画布素材格式无效。");
    media.add(a.id);
  }
  for (const s of b.scenes) {
    if (!s || typeof s.id!=="string" || ids.has(s.id) ||
        ["title","kind","text","cue","sound","notes"].some(key=>typeof s[key]!=="string") ||
        !Number.isFinite(s.x) || !Number.isFinite(s.y) || !Array.isArray(s.clips) ||
        s.clips.some(clip=>!clip || !media.has(clip.assetId))) throw err(400,"分镜或素材引用无效。");
    ids.add(s.id);
  }
  return b;
}
function newBoard(title) {
  return {version:1,revision:0,title,chapters:[{name:"分镜",label:"原片与口播",count:1}],
    scenes:[{id:"01",title:"开场",kind:"分镜",text:"",cue:"",sound:"",notes:"",x:56,y:114,clips:[]}],assets:[]};
}
function newEditor() { return {schema:1,revision:0,clips:[],versions:[],notes:[]}; }
function validateEditor(doc, assets) {
  if (!doc || doc.schema!==1 || !Array.isArray(doc.versions) || doc.versions.length>60 ||
      !Array.isArray(doc.notes) || doc.notes.length>2000) throw err(400,"版本或批注格式无效。");
  try {
    validateClips(doc.clips,assets);
    const versions=new Set();
    for (const v of doc.versions) {
      if (!v || typeof v.id!=="string" || versions.has(v.id) || typeof v.name!=="string" || v.name.length>150 ||
          typeof v.createdAt!=="string" || !["人工","粗剪","Agent","剪映"].includes(v.origin)) throw err(400,"版本格式无效。");
      validateClips(v.clips,assets);
      versions.add(v.id);
    }
    if (doc.notes.some(n=>!n || !versions.has(n.version) || !Number.isSafeInteger(n.at) || n.at<0 ||
        typeof n.text!=="string" || !n.text.trim() || n.text.length>4000)) throw err(400,"批注必须绑定现有版本和具体时间。");
  } catch(e) { throw err(400,e.message); }
}
function list() {
  return fs.readdirSync(projects,{withFileTypes:true}).filter(d=>d.isDirectory() && pidPattern.test(d.name))
    .flatMap(d=>{
      const file=path.join(projects,d.name,"board.json");
      try { const b=read(file);return [{id:d.name,title:b.title,updated:fs.statSync(file).mtimeMs,assets:b.assets.length}]; }
      catch { return []; }
    }).sort((a,b)=>b.updated-a.updated);
}

function stream(req,res,file,mime) {
  const stat=fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw err(404,"素材不可用。");
  const headers={"Content-Type":mime,"X-Content-Type-Options":"nosniff","Accept-Ranges":"bytes","Cache-Control":"no-store"};
  let start=0,end=stat.size-1,status=200;
  if (req.headers.range) {
    const m=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (m?.[1]) { start=Number(m[1]);end=m[2]?Math.min(end,Number(m[2])):end; }
    else if (m?.[2]) start=Math.max(0,stat.size-Number(m[2]));
    if (!m || !(m[1]||m[2]) || !Number.isSafeInteger(start) || start>end) {
      res.writeHead(416,{"Content-Range":"bytes */"+stat.size});res.end();return;
    }
    status=206;
    headers["Content-Range"]=`bytes ${start}-${end}/${stat.size}`;
  }
  headers["Content-Length"]=end-start+1;
  res.writeHead(status,headers);
  if (req.method==="HEAD" || !stat.size) { res.end();return; }
  const source=fs.createReadStream(file,{start,end});
  source.on("error",()=>res.destroy());
  res.on("close",()=>source.destroy());
  source.pipe(res);
}
async function upload(req,res,dir,diagnostics) {
  const name=path.win32.basename(decodeURIComponent(req.headers["x-file-name"]||""));
  const ext=path.extname(name).toLowerCase();
  const length=Number(req.headers["content-length"]);
  if (!type[ext] || !Number.isSafeInteger(length) || length<1 || length>8*1024**3) throw err(400,"素材格式不支持、为空或超过 8 GiB。");
  const expected=req.headers["x-asset-sha256"];
  const assetId=req.headers["x-asset-id"]||id();
  if (!pidPattern.test(assetId) || (expected&&!/^[a-f0-9]{64}$/.test(expected))) throw err(400,"素材标识无效。");
  const file=assetId+ext,target=path.join(dir,"media",file),temp=target+"."+id()+".upload";
  if (fs.existsSync(target) && !expected) throw err(409,"素材已存在。");
  const hash=createHash("sha256");
  let received=0;
  try {
    const meter=new Transform({transform(chunk,enc,cb){received+=chunk.length;hash.update(chunk);cb(null,chunk);}});
    await pipeline(req,meter,fs.createWriteStream(temp,{flags:"wx"}));
    const sha256=hash.digest("hex");
    if (received!==length || (expected&&sha256!==expected)) throw err(400,"素材长度或指纹不匹配。");
    if (fs.existsSync(target)) {
      const oldHash=createHash("sha256");
      for await (const chunk of fs.createReadStream(target)) oldHash.update(chunk);
      if (oldHash.digest("hex")!==sha256) throw err(409,"当前 ID 已有不同的素材。");
    } else fs.renameSync(temp,target);
    diagnostics.record("media_imported");
    reply(res,201,{id:assetId,name,file:"素材库/"+file,mime:type[ext],bytes:received,sha256});
  } finally { try{fs.unlinkSync(temp);}catch{} }
}

fs.mkdirSync(projects,{recursive:true});
process.env.LAOYU_STUDIO_DATA=data;
const tagger=createRequire(import.meta.url)("./tagger/sync-server.js");
export function startStudio({port=Number(process.env.LAOYU_STUDIO_PORT || 18765), desktopKey, webhook, feedbackFetcher, marketFetcher}={}) {
  const market=createMarketplace(data,official,{fetcher:marketFetcher});
  const diagnostics=createDiagnostics(data);
  const feedback=createFeedback({version,webhook,readLogs:diagnostics.recent,fetcher:feedbackFetcher});
const server=http.createServer(async(req,res)=>{
  if (desktopKey && req.headers["x-studio-desktop"]!==desktopKey) {
    return reply(res,403,{error:"请从捞鱼视频创作台应用打开。"});
  }
  if (diagnostics.detailed) {
    const started=performance.now();
    res.once("finish",()=>diagnostics.record("request",{status:res.statusCode,milliseconds:performance.now()-started}));
  }
  const origin="http://127.0.0.1:"+server.address().port;
  if (req.headers.host!==origin.slice(7)) return reply(res,403,{error:"请用本机启动地址。"});
  try {
    const url=new URL(req.url,origin);
    const route=decodeURIComponent(url.pathname);
    const method=req.method;
    if (req.headers["sec-fetch-site"]==="cross-site") throw err(403,"拒绝跨站访问。");
    if (method==="POST" && req.headers.origin!==origin) throw err(403,"请从本机页面执行。");
    if ((method==="GET"||method==="HEAD") && /^\/stickers\/(listen|wave|happy|salute|cheer|ready)\.png$/.test(route)) {
      return stream(req,res,path.join(web,route.slice(1)),"image/png");
    }
    if ((method==="GET"||method==="HEAD") && publicFiles.has(route)) {
      const file=path.join(web,publicFiles.get(route));
      const mime={".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8",".mjs":"text/javascript; charset=utf-8",".png":"image/png"}[path.extname(file)];
      return stream(req,res,file,mime);
    }
    if (route==="/health"&&method==="GET") return reply(res,200,{app:"laoyu-creator-studio",version});
    if (route==="/logs"&&method==="GET") {
      return reply(res,200,{text:await diagnostics.recent(),detailed:diagnostics.detailed});
    }
    if (route.startsWith("/tagger/") || ["/manifest.json","/add-dir","/find-dir","/remove-dir"].includes(route) || route.startsWith("/music/")) {
      return tagger(req,res,route);
    }
    if (route.startsWith("/api/") && method==="POST" && req.headers["x-board-token"]!==token) throw err(403,"请刷新创作台后再操作。");
    if (route==="/api/bgm/database"&&method==="POST") {
      if (!desktopKey) throw err(403,"请从桌面程序保存已绑定的数据库。");
      return reply(res,200,tagger.saveDatabase(await body(req,8*1024*1024)));
    }
    if (route==="/api/diagnostics"&&method==="POST") {
      const input=await body(req,4096);
      if (typeof input?.enabled!=="boolean") throw err(400,"请指定排障模式状态。");
      diagnostics.setDetailed(input.enabled);
      return reply(res,200,{detailed:diagnostics.detailed});
    }
    if (route==="/api/feedback") {
      if (method==="GET") return reply(res,200,{configured:feedback.configured,categories,logPreview:feedbackLog(await diagnostics.recent())});
      if (method==="POST") {
        const input=await body(req,8192);
        try { await feedback.send(input); }
        catch (error) {
          if (error.status===502) diagnostics.record("feedback_failed",{urgent:true});
          throw error;
        }
        diagnostics.record("feedback_sent");
        return reply(res,200,{ok:true});
      }
    }
    if (route==="/api/agent/diagnostics"&&method==="GET") {
      return reply(res,200,{schema:1,application:"捞鱼视频创作台",version,platform:process.platform,
        architecture:process.arch,events:await diagnostics.recent()});
    }
    if (route==="/api/market"&&method==="GET") return reply(res,200,await market.catalog(url.searchParams.get("refresh")==="1"));
    if (route==="/api/market/submission"&&method==="POST") return reply(res,200,validateEntry(await body(req,8192)));
    const downloadRoute=/^\/api\/market\/([a-z0-9-]{2,80})\/(download|asset|use)$/.exec(route);
    if (downloadRoute) {
      const [,resource,action]=downloadRoute;
      if (action==="download"&&method==="POST") return reply(res,200,await market.download(resource));
      if (action==="asset"&&method==="GET") {
        const {entry,bytes}=await market.asset(resource);
        const name=entry.id+(entry.type==="skill"?".zip":".jsonl");
        res.writeHead(200,{"Content-Type":"application/octet-stream","Content-Disposition":`attachment; filename="${name}"`,
          "Content-Length":bytes.length,"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});
        return res.end(bytes);
      }
      if (action==="use"&&method==="POST") {
        const {entry,bytes}=await market.asset(resource);
        if (entry.type!=="bgm") throw err(400,"只可将 BGM 标签包加入图谱。");
        return reply(res,200,saveKnowledgeSource("market:"+entry.id,libraryRows(bytes.toString("utf8"))));
      }
    }
    if (route==="/api/knowledge"&&method==="GET") {
      const {sources,curation}=knowledge();
      return reply(res,200,sourceGraph(sources,curation));
    }
    if (route==="/api/knowledge/source"&&method==="POST") {
      const input=await body(req,8*1024*1024);
      if (!["tagger","file"].includes(input?.source)) throw err(400,"来源无效。");
      return reply(res,200,saveKnowledgeSource(input.source,libraryRows(input.rows)));
    }
    if (route==="/api/knowledge/curation"&&method==="POST") {
      const candidate=await body(req,1024*1024);
      const state=knowledge();
      const graph=sourceGraph(state.sources,state.curation);
      state.curation={revision:graph.revision,insights:validateInsights(candidate,graph)};
      write(knowledgeFile,state);
      return reply(res,200,sourceGraph(state.sources,state.curation));
    }
    if (route==="/api/projects") {
      if (method==="GET") return reply(res,200,{projects:list(),token,version,...(desktopKey?{desktopDataDirectory:data}:{})});
      if (method==="POST") {
        const input=await body(req);
        const title=input.title?.trim();
        if (!title || title.length>140) throw err(400,"请填写项目名称。");
        const board=input.board ? validBoard({...input.board,title,revision:0}) : newBoard(title);
        const projectId=id(),dir=path.join(projects,projectId);
        fs.mkdirSync(path.join(dir,"media"),{recursive:true});
        write(path.join(dir,"editor.json"),newEditor());
        write(path.join(dir,"board.json"),board);
        diagnostics.record("project_created");
        return reply(res,201,{id:projectId});
      }
    }
    const parts=/^\/api\/project\/([a-f0-9]{32})\/(board|workspace|editor|media)(?:\/([a-f0-9]{32}\.[a-z0-9]{2,5}))?$/.exec(route);
    if (parts) {
      const [,projectId,section,file]=parts;
      const dir=path.join(projects,projectId);
      const boardPath=path.join(dir,"board.json"),editorPath=path.join(dir,"editor.json");
      if (!fs.existsSync(boardPath)) throw err(404,"找不到这个项目。");
      if (section==="media"&&file&&["GET","HEAD"].includes(method)) {
        if (!type[path.extname(file)] || !fs.existsSync(path.join(dir,"media",file))) throw err(404,"找不到本机素材，请重新链接。");
        return stream(req,res,path.join(dir,"media",file),type[path.extname(file)]);
      }
      if (section==="media"&&!file&&method==="POST") return await upload(req,res,dir,diagnostics);
      if (section==="board"&&method==="GET") return reply(res,200,{board:read(boardPath),token});
      if (section==="workspace"&&method==="GET") return reply(res,200,{board:read(boardPath),editor:read(editorPath)});
      if (section==="board"&&method==="POST") {
        const next=validBoard(await body(req));
        const current=read(boardPath);
        if (next.revision!==current.revision) throw err(409,"画布已在另一窗口更新，请先导出备份再重开。");
        const editor=read(editorPath);
        validateEditor(editor,next.assets);
        next.revision++;
        write(boardPath,next);
        diagnostics.record("board_saved");
        return reply(res,200,{revision:next.revision});
      }
      if (section==="editor"&&method==="POST") {
        const next=await body(req),current=read(editorPath),board=read(boardPath);
        if (next.revision!==current.revision) throw err(409,"剪辑已在另一窗口更新，请导出当前改动再重开。");
        validateEditor(next,board.assets);
        next.revision++;
        write(editorPath,next);
        diagnostics.record("timeline_saved");
        return reply(res,200,{revision:next.revision});
      }
    }
    throw err(404,"未找到页面。");
  } catch(error) {
    if (res.headersSent || res.destroyed) { res.destroy();return; }
    if (!error.status) diagnostics.record("request_failed",{urgent:true});
    reply(res,error.status||500,{error:error.status?error.message:"本机读写失败，请检查磁盘与素材。"});
  }
});
  return new Promise((resolve,reject)=>{
    function failed(error) {
      void diagnostics.stop();
      reject(error);
    }
    server.once("error",failed);
    server.listen(port,"127.0.0.1",()=>{
      server.off("error",failed);
      diagnostics.record("studio_started");
      resolve({server,origin:"http://127.0.0.1:"+server.address().port,async stop() {
        await new Promise(resolve=>{
          server.close(resolve);
          server.closeAllConnections();
        });
        await diagnostics.stop();
      }});
    });
  });
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const {origin}=await startStudio();
  console.log("捞鱼视频创作台 "+version+" · "+origin);
}