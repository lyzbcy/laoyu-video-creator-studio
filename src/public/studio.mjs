import { agentPage, graphPage, marketPage, taggerSource } from "./agent-ui.mjs";
import { mountEditor } from "./editor.mjs";

const main=document.querySelector("#main");
const toastNode=document.querySelector("#toast");
let token, version, current, routeSerial=0, toastTimer;
export let desktopDataDirectory=null;
const imports=new Map();
export const e=(tag,props={},...children)=>{
  const el=document.createElement(tag);
  for (const [key,value] of Object.entries(props)) {
    if (key==="cls") el.className=value;
    else if (key.startsWith("on")) el.addEventListener(key.slice(2),value);
    else if (key==="checked"||key==="disabled"||key==="value") el[key]=value;
    else el.setAttribute(key,value);
  }
  el.append(...children.filter(x=>x!==null&&x!==undefined));
  return el;
};
export const btn=(label,click,cls="",extra={})=>e("button",{type:"button",cls,onclick:click,...extra},label);
export const link=(label,href,cls="")=>e("a",{href,cls},label);
export const sticker=name=>e("img",{cls:"sticker",alt:"",src:"/stickers/"+name+".png"});
export const ms=seconds=>Math.round(Number(seconds)*1000);
export const stamp=(time,precise=false)=>{
  const s=Math.floor(time/1000);
  const label=String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0");
  return precise?label+"."+String(time%1000).padStart(3,"0"):label;
};
export const endpoint=(id,part)=>"/api/project/"+encodeURIComponent(id)+"/"+part;
export const media=(id,asset)=>endpoint(id,"media/"+encodeURIComponent(asset.file.split("/").at(-1)));

export async function request(url, options={}) {
  const res=await fetch(url,options);
  const data=await res.json();
  if(!res.ok) throw new Error(data.error||"本机服务请求失败。");
  return data;
}
export function post(url,document) {
  return request(url,{method:"POST",headers:{"Content-Type":"application/json","X-Board-Token":token},body:JSON.stringify(document)});
}
export function upload(id,file,extra={}) {
  return request(endpoint(id,"media"),{method:"POST",headers:{"X-Board-Token":token,"X-File-Name":encodeURIComponent(file.name),...extra},body:file});
}
export function notify(message) {
  clearTimeout(toastTimer);
  toastNode.textContent=message;
  toastNode.hidden=false;
  toastTimer=setTimeout(()=>toastNode.hidden=true,7000);
}
export function run(fn) {
  return async event=>{
    try { await fn(event); } catch(error) { notify(error.message); }
  };
}
export function download(filename,content,mime="application/json") {
  const blob=new Blob([content],{type:mime}),url=URL.createObjectURL(blob);
  const anchor=e("a",{href:url,download:filename});
  anchor.click();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
}
export function chooseFiles({folder=false,accept="",multiple=false}={}) {
  return new Promise(resolve=>{
    const input=e("input",{type:"file",accept});
    if(folder) input.setAttribute("webkitdirectory","");
    if(multiple) input.multiple=true;
    input.addEventListener("change",()=>resolve([...input.files]),{once:true});
    input.addEventListener("cancel",()=>resolve([]),{once:true});
    input.click();
  });
}
export async function readJson(file) {
  if (file.size>16*1024*1024) throw new Error("文件过大。");
  try{return JSON.parse((await file.text()).replace(/^\uFEFF/,""));}
  catch{throw new Error("无法读取 JSON。新版加密剪映草稿需要兼容适配器。");}
}
export function modal(title,children) {
  const dialog=e("dialog",{cls:"dialog"},e("h2",{},title),...children);
  document.body.append(dialog);
  dialog.addEventListener("close",()=>dialog.remove(),{once:true});
  dialog.showModal();
  return dialog;
}
function heading(title,actions=[]) { return e("header",{cls:"heading"},e("h1",{},title),e("div",{cls:"row"},...actions)); }
const fmtDate=n=>new Date(n).toLocaleString("zh-CN",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"});
const projectLink=(id,tab="board")=>"#project/"+id+"/"+tab;
async function reload() {
  const response=await request("/api/projects");
  token=response.token;
  version=response.version;
  desktopDataDirectory=response.desktopDataDirectory??null;
  if (desktopDataDirectory && /Windows/.test(navigator.userAgent)) document.documentElement.dataset.desktop="windows";
  document.querySelector("#version").textContent=version+" · 本机";
  return response.projects;
}
function newProject() {
  const title=e("input",{placeholder:"例如：两台电脑一双手",maxlength:140,"aria-label":"项目名称",required:""});
  const form=e("form",{},title,e("div",{cls:"row"},e("button",{cls:"primary",type:"submit"},"创建"),btn("取消",()=>dialog.close())));
  const dialog=modal("新建剪辑项目",[form]);
  form.onsubmit=run(async(event)=>{
    event.preventDefault();
    const submit=form.querySelector('button[type="submit"]');
    if(submit.disabled) return;
    submit.disabled=true;
    try {
      const item=await post("/api/projects",{title:title.value});
      dialog.close();
      location.hash=projectLink(item.id);
    } finally {submit.disabled=false;}
  });
  title.focus();
}
async function importBoard() {
  const files=await chooseFiles({folder:true});
  if(!files.length) return;
  const config=files.find(f=>f.name==="画布.json")??files.find(f=>f.name==="board.json");
  if(!config) throw new Error("选择包含画布.json 的项目目录。");
  const board=await readJson(config);
  const created=await post("/api/projects",{title:board.title,board});
  const prefix=config.webkitRelativePath.slice(0,-config.name.length);
  const lookup=new Map(files.map(f=>[f.webkitRelativePath,f]));
  let imported=0,missing=0;
  for (const asset of board.assets) {
    const file=lookup.get(prefix+asset.file)??lookup.get(prefix+"media/"+asset.file.split("/").at(-1));
    if (!file || !asset.sha256) { missing++;continue; }
    try {
      await upload(created.id,file,{"X-Asset-Id":asset.id,"X-Asset-Sha256":asset.sha256});
      notify("正在导入原片 "+(++imported)+" / "+board.assets.length);
    } catch {missing++;}
  }
  notify("已导入画布及 "+imported+" 个素材。"+(missing?"另有 "+missing+" 个素材待重新链接。":""));
  location.hash=projectLink(created.id);
}
async function importDraftProject() {
  const files=await chooseFiles({folder:true});
  if(!files.length) return;
  const source=files.find(f=>f.name==="draft_content.json")??files.find(f=>f.name==="draft_info.json");
  if(!source) throw new Error("请选择包含 draft_content.json 或 draft_info.json 的目录。");
  const draft=await readJson(source);
  if(!Array.isArray(draft.tracks)||!draft.materials) throw new Error("没有识别到基础剪映草稿轨道。");
  const name=source.webkitRelativePath.split("/")[0]||"剪映草稿";
  const project=await post("/api/projects",{title:name});
  imports.set(project.id,{files,draft});
  location.hash=projectLink(project.id,"timeline");
}
function projectList(items) {
  const search=e("input",{type:"search",placeholder:"搜索项目","aria-label":"搜索项目"});
  const grid=e("div",{cls:"projects"});
  const render=()=>{
    const filtered=items.filter(item=>item.title.toLowerCase().includes(search.value.toLowerCase()));
    grid.replaceChildren(...filtered.map(item=>e("article",{cls:"card project-card"},
      e("div",{cls:"project-graphic","aria-hidden":"true"},"▣"),
      e("h2",{},item.title),e("small",{},item.assets+" 项素材 · "+fmtDate(item.updated)),
      link("继续编辑",projectLink(item.id),"action"))));
    if(!filtered.length) grid.append(e("div",{cls:"empty"},sticker("wave"),e("p",{},items.length?"没有匹配的项目。":"新建项目后，把原片拖进素材画布。")));
  };
  search.oninput=render;
  render();
  return [heading("剪辑项目",[btn("＋ 新建项目",newProject,"primary"),btn("导入旧画布",run(importBoard)),btn("导入剪映草稿",run(importDraftProject)),search]),grid];
}
function heroGraphic(kind) {
  const ns="http://www.w3.org/2000/svg";
  const svg=document.createElementNS(ns,"svg");
  svg.setAttribute("viewBox","0 0 210 48");
  svg.setAttribute("aria-hidden","true");
  const shape=(name,fields)=>{
    const node=document.createElementNS(ns,name);
    for(const [key,value] of Object.entries(fields)) node.setAttribute(key,value);
    svg.append(node);
  };
  if(kind==="music") {
    const heights=[8,12,19,13,28,36,21,12,6,9,15,28,19,37,26,14,6,8,13,19,30,14,9,5];
    heights.forEach((height,i)=>shape("line",{x1:4+i*8,y1:24-height/2,x2:4+i*8,y2:24+height/2,stroke:"currentColor","stroke-width":3,"stroke-linecap":"round"}));
  } else {
    for(let i=0;i<3;i++) shape("rect",{x:8+i*62,y:14,width:60,height:25,rx:4,fill:i===1?"#f8b29d":"none",stroke:"#b59e8f"});
    shape("path",{d:"M99 7h12l-6 7v31",stroke:"#df503c",fill:"#df503c","stroke-width":2});
  }
  return svg;
}
function hero(title,description,href,kind,character) {
  const icon=e("span",{"aria-hidden":"true"},kind==="music"?"♫":"▣");
  const visual=e("div",{},icon,e("h2",{},title),e("p",{cls:"muted"},description),heroGraphic(kind),link("进入工作区 ›",href,"action primary"));
  return e("article",{cls:"hero "+kind},visual,sticker(character));
}
function home(items) {
  const recent=e("div",{cls:"recent"});
  if(items.length) recent.append(...items.slice(0,5).map(item=>link(item.title+" · "+fmtDate(item.updated),projectLink(item.id))));
  else recent.append(e("div",{cls:"empty"},sticker("happy"),e("p",{},"这里会显示最近编辑的项目。")));
  return [heading("开始创作"),e("div",{cls:"hero-grid"},
    hero("BGM 打标","整理音乐与音效","#library","music","listen"),
    hero("AI 辅助剪辑","原片标注、粗剪与人工微调","#projects","edit","wave")),
    e("div",{cls:"recent-grid"},e("article",{cls:"card"},e("div",{cls:"card-title"},e("h2",{},"最近项目"),btn("＋ 新建项目",newProject)),recent),sticker("ready"))];
}
async function openFeedback() {
  if (document.querySelector("#feedback-form")) return;
  const button=document.querySelector("#feedback-button");
  button.disabled=true;
  let info;
  try { info=await request("/api/feedback"); }
  finally { button.disabled=false; }

  const category=e("select",{"aria-label":"问题类别"},e("option",{value:""},"不分类"),
    ...info.categories.map(value=>e("option",{value},value)));
  const message=e("textarea",{rows:5,maxlength:480,required:"","aria-label":"反馈留言",
    placeholder:"例如，你在哪一步遇到了问题，预期会发生什么？"});
  const includeLogs=e("input",{type:"checkbox",checked:true});
  const preview=e("details",{},e("summary",{},"预览最近的诊断摘要"),e("pre",{},info.logPreview||"当前暂无日志。"));
  const status=e("p",{role:"status",cls:"muted"},info.configured?"":"此设备尚未配置企业微信反馈机器人。可以先复制留言留存。");
  const submit=e("button",{type:"submit",cls:"primary",disabled:!info.configured},"发送反馈");
  const close=btn("关闭",()=>dialog.close());
  const copy=info.configured?null:btn("复制留言",run(async()=>{
    await navigator.clipboard.writeText(message.value.trim());
    status.textContent="已复制留言。";
  }));
  const form=e("form",{id:"feedback-form",cls:"feedback-form"},
    e("p",{cls:"muted"},"捞鱼视频创作台 · "+version+"。点击发送后，留言会发给开发者的企业微信群。"),
    e("label",{},"问题类别（选填）",category),e("label",{},"留言",message),
    e("label",{cls:"check-line"},includeLogs,"附带诊断摘要"),
    e("p",{cls:"muted"},"摘要只含操作类型、时间、状态和耗时。素材、文件名、路径、项目内容和账号信息不在摘要内。"),
    preview,status,e("div",{cls:"row"},submit,copy,close));
  const dialog=modal("遇到问题反馈",[form]);
  includeLogs.onchange=()=>{ preview.hidden=!includeLogs.checked; };
  dialog.addEventListener("cancel",event=>{if(close.disabled)event.preventDefault();});
  form.onsubmit=async event=>{
    event.preventDefault();
    if (submit.disabled) return;
    if (!message.value.trim()) { status.textContent="请填写留言。";message.focus();return; }
    submit.disabled=true;
    close.disabled=true;
    status.textContent="正在等待企业微信确认…";
    try {
      await post("/api/feedback",{category:category.value,message:message.value,includeLogs:includeLogs.checked});
      dialog.close();
      notify("企业微信已确认收到反馈。");
    } catch(error) {
      status.textContent=error.message;
      submit.disabled=false;
      close.disabled=false;
    }
  };
  message.focus();
}
document.querySelector("#feedback-button").addEventListener("click",run(openFeedback));

function settings() {
  const output=e("pre",{hidden:""});
  const storage=e("section",{cls:"card"},e("h2",{},"本地工作区"),
    e("p",{cls:"muted"},"工程数据保存在本机 LaoyuCreatorStudio 目录。原片和曲库数据分开管理。"));
  const draft=e("section",{cls:"card"},e("h2",{},"剪映草稿"),
    e("p",{cls:"muted"},"目前可识别基础明文草稿。11.6 原生往返待验证。"),link("前往剪辑项目","#projects"));
  const detailed=e("input",{type:"checkbox",disabled:true});
  const refresh=async()=>{
    const state=await request("/logs");
    detailed.checked=state.detailed;
    detailed.disabled=false;
    return state.text||"暂无日志。";
  };
  detailed.onchange=run(async()=>{
    const enabled=detailed.checked;
    detailed.disabled=true;
    try {
      await post("/api/diagnostics",{enabled});
      notify(enabled?"已开启本次运行的排障模式。":"已关闭排障模式。");
    } catch(error) {detailed.checked=!enabled;throw error;}
    finally {detailed.disabled=false;}
  });
  void refresh().catch(error=>notify(error.message));
  const logs=e("section",{cls:"card"},e("h2",{},"诊断"),
    e("label",{cls:"check-line"},detailed,"排障模式（本次运行）"),
    e("p",{cls:"muted"},"开启后增加请求状态和耗时。诊断记录保存在本机，可查看后复制。"),
    e("div",{cls:"row"},
      btn("查看日志",run(async()=>{output.textContent=await refresh();output.hidden=false;})),
      btn("复制日志",run(async()=>{await navigator.clipboard.writeText(await refresh());notify("已复制诊断日志。");})),
      link("交给 Agent 排障","#agent","action")),output);
  return [heading("设置"),e("div",{cls:"settings"},storage,draft,logs)];
}

const tabNames={board:"素材画布",timeline:"剪辑时间线",review:"版本审阅"};
function nav(active) {
  for (const anchor of document.querySelectorAll("[data-nav]")) {
    if (anchor.dataset.nav===active) anchor.setAttribute("aria-current","page");
    else anchor.removeAttribute("aria-current");
  }
}
function leave() {
  current?.editor?.dispose();
  current=null;
  main.className="";
}
async function updateRoute() {
  const number=++routeSerial;
  const name=location.hash.slice(1)||"home";
  const match=/^project\/([a-f0-9]{32})\/(board|timeline|review)$/.exec(name);
  if(current?.library&&!['library','tools'].includes(name)) {
    await current.library.contentWindow.flushStudioBgm?.();
    if(number!==routeSerial) return;
  }
  if(current?.board&&!current.board.hidden && (!match||match[1]!==current.id||match[2]!=="board")) {
    try { await current.board.contentWindow.flushStudioBoard?.();current.board.contentWindow.postMessage("studio-hide",location.origin); }
    catch(error){ notify(error.message);history.replaceState(null,"",projectLink(current.id,"board"));return; }
  }
  if(current?.editor?.isSaving()) {
    await current.editor.wait();
    if(number!==routeSerial) return;
  }
  if(match) {
    const [,id,tab]=match;
    nav("projects");
    if(current?.id!==id) {
      const workspace=await request(endpoint(id,"workspace"));
      if(number!==routeSerial) return;
      leave();
      main.className="fill";
      const breadcrumb=e("div",{cls:"breadcrumb"},link("剪辑项目","#projects")," / ",e("strong",{},workspace.board.title));
      const tabs=e("nav",{cls:"tabs","aria-label":"项目功能"},...Object.entries(tabNames).map(([key,label])=>link(label,projectLink(id,key))));
      const board=e("iframe",{cls:"frame frame-area",title:"素材画布",hidden:""});
      const editor=e("section",{id:"editor",hidden:""});
      main.replaceChildren(breadcrumb,tabs,board,editor);
      current={id,board,tabs,editor:mountEditor(editor,id)};
    }
    const state=current;
    for(const a of state.tabs.children) a.setAttribute("aria-current",String(a.hash===projectLink(id,tab)));
    state.board.hidden=tab!=="board";
    if(tab==="board"&&!state.board.getAttribute("src")) state.board.src="/board.html?project="+id;
    await state.editor.show(tab);
    const data=imports.get(id);
    if(data&&tab==="timeline"&&number===routeSerial) {
      imports.delete(id);
      await state.editor.loadDraft(data);
    }
    return;
  }
  if(["library","tools"].includes(name)) {
    nav("library");
    if(!current?.library) {
      leave();
      main.className="fill";
      const library=e("iframe",{cls:"frame frame-area",title:"音乐与音效库",
        src:"/tagger/?server="+encodeURIComponent(location.origin)});
      const tabs=e("nav",{cls:"tabs","aria-label":"曲库功能"},link("音乐 / 音效库","#library"),link("曲库工具","#tools"));
      const sync=btn("同步标签到图谱",run(async event=>{
        const button=event.currentTarget;
        button.disabled=true;
        try {
          const rows=await taggerSource(library);
          await post("/api/knowledge/source",{source:"tagger",rows});
          if(!rows.length)notify("当前打标库为空，已同步。");
          location.hash="#graph";
        } finally {button.disabled=false;}
      }));
      tabs.append(sync);
      main.replaceChildren(tabs,library);
      current={library,tabs};
      library.addEventListener("load",()=>{library.contentDocument.body.dataset.mode=location.hash==="#tools"?"tools":"library";});
    }
    for(const a of current.tabs.children) a.setAttribute("aria-current",String(a.hash==="#"+name));
    if(current.library.contentDocument?.body) current.library.contentDocument.body.dataset.mode=name;
    return;
  }
  leave();
  nav(name);
  if(name==="agent") {main.replaceChildren(...agentPage());return;}
  if(name==="graph" || name==="market") {
    main.replaceChildren(e("p",{cls:"muted"},"正在读取本机资料…"));
    const payload=await request(name==="graph"?"/api/knowledge":"/api/market");
    if(number===routeSerial)main.replaceChildren(...(name==="graph"?graphPage(payload):marketPage(payload)));
    return;
  }
  if(name==="settings") {main.replaceChildren(...settings());return;}
  const items=await reload();
  if(number===routeSerial) main.replaceChildren(...(name==="projects"?projectList(items):home(items)));
}
window.addEventListener("message",run(async event=>{
  if(event.origin!==location.origin||event.source!==current?.library?.contentWindow||event.data?.type!=="studio-bgm")return;
  const {file,duration}=event.data;
  if(!(file instanceof File)||!file.size||file.size>100*1024*1024)return;
  const items=await reload();
  if(!items.length)throw new Error("先创建一个剪辑项目。");
  const select=e("select",{"aria-label":"选择剪辑项目"},...items.map(item=>e("option",{value:item.id},item.title)));
  const dialog=modal("加入项目素材",[e("p",{},file.name),select,e("div",{cls:"row"},
    btn("加入项目",run(async event=>{
      const button=event.currentTarget;
      if(button.disabled)return;
      button.disabled=true;
      try {
        const id=select.value;
        const uploaded=await upload(id,file);
        const {board}=await request(endpoint(id,"board"));
        const a={...uploaded,duration:Number.isFinite(duration)&&duration>0?duration:null};
        await post(endpoint(id,"board"),{...board,assets:[...board.assets,a]});
        dialog.close();notify("已加入项目素材，可在剪辑时间线添加。");location.hash=projectLink(id,"timeline");
      } finally {button.disabled=false;}
    }),"primary"),btn("取消",()=>dialog.close()))]);
}));
window.addEventListener("hashchange",run(updateRoute));
window.flushStudioWindow = async () => {
  if (current?.library) await current.library.contentWindow.flushStudioBgm?.();
  if (current?.board && !current.board.hidden) await current.board.contentWindow.flushStudioBoard?.();
  if (current?.editor?.isSaving()) await current.editor.flush();
};
try { await reload();await updateRoute(); }
catch(error){main.replaceChildren(e("h1",{},"无法打开创作台"),e("p",{cls:"muted"},error.message));}