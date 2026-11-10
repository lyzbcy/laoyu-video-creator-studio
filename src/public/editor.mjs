import { desktopDataDirectory,e,btn,sticker,stamp,ms,endpoint,media,request,post,upload,notify,run,download,chooseFiles,readJson,modal } from "./studio.mjs";
import { kinds,labels,newId,endOf,durationOf,sourceKind,validateClips,makeClip,splitClip,roughCut,applyOperations,parseDraft } from "./timeline.mjs";

function preview(project, lookup, muted=false) {
  const video=e("video",{playsinline:"",preload:"metadata",hidden:""});
  const image=e("img",{alt:"",hidden:""});
  const caption=e("div",{cls:"subtitle",hidden:""});
  const empty=e("p",{cls:"placeholder"},"播放头处没有画面");
  const stage=e("div",{cls:"player-stage"},video,image,empty,caption);
  const players=new Map();
  let desired, visual=null;
  function sync(player, clip, t, playing) {
    const target=(clip.from+t-clip.at)/1000;
    if (player.readyState>=1 && Number.isFinite(target) &&
        Math.abs(player.currentTime-target)>(playing?.25:.012)) {
      try { player.currentTime=target; } catch {}
    }
    player.volume=clip.volume;
    player.muted=muted;
    if (playing && player.paused && player.readyState>=2) player.play().catch(()=>{});
    if (!playing && !player.paused) player.pause();
  }
  function render(t, clips, playing) {
    desired={t,clips,playing};
    const active=clips.filter(c=>c.at<=t&&t<endOf(c));
    const visualClip=active.filter(c=>c.kind==="video").sort((a,b)=>b.lane-a.lane)[0];
    const asset=visualClip&&lookup(visualClip.asset);
    const next=asset?.id??null;
    if (visual!==next) {
      visual=next;
      video.pause();
      if (asset&&sourceKind(asset)==="video") video.src=media(project,asset);
      else if (video.hasAttribute("src")) {video.removeAttribute("src");video.load();}
      if (asset&&sourceKind(asset)==="image") image.src=media(project,asset);
    }
    video.hidden=!asset||sourceKind(asset)!=="video";
    image.hidden=!asset||sourceKind(asset)!=="image";
    empty.hidden=!!asset;
    if(!video.hidden) sync(video,visualClip,t,playing);
    const lines=active.filter(c=>c.kind==="caption").map(c=>c.text);
    caption.hidden=!lines.length;
    caption.textContent=lines.join(" / ");
    const audio=active.filter(c=>c.kind==="audio");
    const ids=new Set(audio.map(c=>c.id));
    for(const [key,player] of players) {
      if(!ids.has(key)) {player.pause();players.delete(key);}
    }
    for(const clip of audio) {
      const a=lookup(clip.asset);
      if(!a||muted) continue;
      let player=players.get(clip.id);
      if(!player) {
        player=new Audio(media(project,a));
        player.preload="auto";
        player.addEventListener("loadeddata",()=>{
          if(desired&&players.get(clip.id)===player) render(desired.t,desired.clips,desired.playing);
        });
        players.set(clip.id,player);
      }
      sync(player,clip,t,playing);
    }
  }
  video.addEventListener("loadeddata",()=>{if(desired)render(desired.t,desired.clips,desired.playing);});
  video.addEventListener("error",()=>{
    if(video.hidden)return;
    empty.textContent="当前素材无法预览，请检查源文件或使用兼容的 MP4。";
    empty.hidden=false;
  });
  return {stage,render,dispose(){desired=null;video.pause();video.removeAttribute("src");video.load();for(const player of players.values())player.pause();players.clear();}};
}

export function mountEditor(container,project) {
  let board, doc, tab, previewA, previewB, timeNode, seekNode, transportButton, raf, saving, alive=true;
  let visible=false, playing=false, previous, playhead=0, selected, zoom=1, candidate, compareId, showSerial=0;
  let undo=[],redo=[], notesRange={start:"",end:"",instruction:""};
  const asset=id=>board.assets.find(a=>a.id===id);
  const handoffKey="creator-handoff-"+project;
  const currentClip=()=>doc.clips.find(c=>c.id===selected);
  const baseVersion=()=>doc.versions.at(-1);
  function selectedVersion(){return doc.versions.find(v=>v.id===compareId)??baseVersion();}
  const viewClips=()=>tab==="review"?(selectedVersion()?.clips??doc.clips):doc.clips;
  const reviewClips=()=>candidate?.clips??doc.clips;
  const maxTime=()=>Math.max(durationOf(viewClips()),tab==="review"?durationOf(reviewClips()):0);
  function refreshFrame() {
    const main=tab==="review"?reviewClips():doc.clips;
    previewA?.render(playhead,main,playing);
    if (tab==="review") previewB?.render(playhead,viewClips(),playing);
    if(timeNode) timeNode.textContent=stamp(playhead,true);
    if(seekNode) seekNode.value=playhead;
    const t=scale();
    for(const line of container.querySelectorAll(".playhead")) line.style.left=Math.min(100,playhead/t*100)+"%";
  }
  function tick(now) {
    if(!playing)return;
    playhead=Math.min(maxTime(),playhead+Math.round(now-(previous??now)));
    previous=now;
    if (playhead>=maxTime()) {pause();refreshFrame();return;}
    refreshFrame();
    raf=requestAnimationFrame(tick);
  }
  function pause() {
    playing=false;previous=null;cancelAnimationFrame(raf);
    if(transportButton) transportButton.textContent="▶";
    if(doc) refreshFrame();
  }
  function toggle() {
    if(playing){pause();return;}
    if(!maxTime()) return notify("时间线上还没有可播放的内容。");
    if(playhead>=maxTime())playhead=0;
    playing=true;
    transportButton.textContent="Ⅱ";
    refreshFrame();
    raf=requestAnimationFrame(tick);
  }
  function seek(value) {
    playhead=Math.max(0,Math.min(maxTime(),Math.round(value)));
    refreshFrame();
  }
  function resetPreviews() {
    playing=false;previous=null;cancelAnimationFrame(raf);
    previewA?.dispose();previewB?.dispose();previewA=previewB=timeNode=seekNode=transportButton=null;
  }
  function player(view,controls=true) {
    const panel=e("section",{cls:"player"},view.stage);
    if(controls) {
      timeNode=e("time",{},stamp(playhead,true));
      seekNode=e("input",{type:"range",min:0,max:Math.max(1,maxTime()),step:1,value:playhead,
        "aria-label":"成片播放头",oninput:event=>seek(Number(event.target.value))});
      transportButton=btn("▶",toggle,"",{title:"播放或暂停","aria-label":"播放或暂停"});
      panel.append(e("div",{cls:"transport"},transportButton,seekNode,timeNode));
    }
    return panel;
  }
  function scale() {
    return Math.max(1000,Math.ceil(maxTime()/5000)*5000,Math.ceil(20000/zoom));
  }

  async function save(next) {
    if(saving)throw new Error("正在保存，请稍等。");
    saving=post(endpoint(project,"editor"),next);
    try { const {revision}=await saving;doc={...next,revision}; }
    finally { saving=null; }
  }
  async function commit(clips, history=true, snapshot=null) {
    validateClips(clips,board.assets);
    const old=doc.clips;
    const versions=snapshot?[...doc.versions,snapshot]:doc.versions;
    await save({...doc,clips,versions});
    if(history){undo=[...undo,old].slice(-40);redo=[];}
    if(!currentClip())selected=null;
    seek(playhead);
    paint();
  }
  function snapshot(name,origin,clips=doc.clips) {
    return {id:newId(),name,origin,clips,createdAt:new Date().toISOString()};
  }
  async function saveVersion() {
    const name=window.prompt("版本名称","人工微调 "+(doc.versions.length+1))?.trim();
    if(!name)return;
    const v=snapshot(name.slice(0,150),"人工");
    await save({...doc,versions:[...doc.versions,v]});
    compareId=v.id;
    paint();notify("已保存版本");
  }
  async function history(which) {
    const source=which==="undo"?undo:redo, target=source.at(-1);
    if(!target)return;
    const old=doc.clips;
    await commit(target,false);
    source.pop();
    if(which==="undo")redo.push(old);else undo.push(old);
    paint();
  }
  async function addAsset(a) {
    const kind=sourceKind(a)==="audio"?"audio":"video";
    let seconds=a.duration;
    if(!seconds&&sourceKind(a)!=="image") {
      seconds=await new Promise(resolve=>{
        const video=e(kind==="audio"?"audio":"video",{preload:"metadata",src:media(project,a)});
        let done=false;
        const settle=value=>{if(done)return;done=true;clearTimeout(timer);video.removeAttribute("src");video.load();resolve(value);};
        const timer=setTimeout(()=>settle(null),5500);
        video.onloadedmetadata=()=>settle(Number.isFinite(video.duration)?video.duration:null);
        video.onerror=()=>settle(null);
      });
    }
    if(!seconds&&sourceKind(a)!=="image")throw new Error("未读到素材时长，请在原片画布中填写时长或换用可播放格式。");
    const at=Math.max(0,...doc.clips.filter(c=>c.kind===kind&&c.lane===0).map(endOf));
    const clip=makeClip(kind,{at,asset:a.id,length:ms(seconds||3),label:a.name.slice(0,160)});
    selected=clip.id;
    await commit([...doc.clips,clip]);seek(at);
  }
  async function addCaption() {
    const text=window.prompt("字幕文字")?.trim();
    if(!text)return;
    const next=makeClip("caption",{at:playhead,length:2500,text:text.slice(0,12000),label:"字幕"});
    const intersect=doc.clips.some(c=>c.kind==="caption"&&c.lane===0&&c.at<endOf(next)&&endOf(c)>next.at);
    if(intersect)throw new Error("这段已有字幕，请先移到空白位置或修改已有字幕。");
    selected=next.id;await commit([...doc.clips,next]);
  }
  async function relink() {
    const files=await chooseFiles({multiple:true,accept:"video/*,audio/*,image/*,.mkv,.avi,.mov"});
    if(!files.length)return;
    let count=0;
    for(const file of files) {
      const matches=board.assets.filter(a=>a.name===file.name&&a.bytes===file.size&&a.sha256);
      for(const a of matches) {
        try {await upload(project,file,{"X-Asset-Id":a.id,"X-Asset-Sha256":a.sha256});count++;}
        catch {}
      }
    }
    notify(count?"已重新链接 "+count+" 项素材。":"未找到文件名、大小和哈希都匹配的素材。");
  }

  function ruler(lane,total) {
    for(let i=0;i<=8;i++) {
      const mark=e("i",{},stamp(Math.round(i*total/8)));
      mark.style.left=(i*12.5)+"%";
      mark.style.transform=i===8?"translateX(-100%)":"";
      lane.append(mark);
    }
  }
  function laneClick(event) {
    if(event.target.closest(".clip"))return;
    const box=event.currentTarget.getBoundingClientRect();
    seek(scale()*(event.clientX-box.left)/box.width);
  }
  function clipNode(c,total) {
    const text=(c.locked?"🔒 ":"")+(c.kind==="caption"?c.text:c.label);
    const item=btn(text,event=>{
      if(item.dataset.moved==="true")return;
      selected=c.id;seek(c.at);paint();
    },"clip "+c.kind,{title:text,"aria-pressed":String(c.id===selected),"data-locked":String(c.locked)});
    item.style.left=(c.at/total*100)+"%";
    item.style.width=(c.length/total*100)+"%";
    if(c.locked)return item;
    item.append(e("span",{cls:"trim-handle trim-start","data-trim":"start",title:"拖动修剪起点","aria-hidden":"true"}),
      e("span",{cls:"trim-handle trim-end","data-trim":"end",title:"拖动修剪末尾","aria-hidden":"true"}));
    item.addEventListener("pointerdown",event=>{
      if(event.button!==0)return;
      const start=event.clientX;
      const width=item.parentElement.clientWidth;
      let moved=false, next={...c};
      const mode=event.target.dataset.trim;
      const minimum=Math.min(40,c.length);
      const limit=c.kind==="caption"||sourceKind(asset(c.asset))==="image"?Infinity:(asset(c.asset)?.duration??Infinity)*1000;
      const pointer=event.pointerId;
      item.setPointerCapture(pointer);
      const move=ev=>{
        if(ev.pointerId!==pointer)return;
        const dx=ev.clientX-start;
        if(Math.abs(dx)<5&&!moved)return;
        moved=true;
        const delta=Math.round(dx/width*total/10)*10;
        if(mode==="start") {
          const min=c.kind==="caption"?-c.at:Math.max(-c.at,-c.from);
          const offset=Math.max(min,Math.min(c.length-minimum,delta));
          next={...c,at:c.at+offset,length:c.length-offset,from:c.kind==="caption"?0:c.from+offset};
        } else if(mode==="end") {
          next={...c,length:Math.floor(Math.max(minimum,Math.min(limit-c.from,c.length+delta)))};
        } else next={...c,at:Math.max(0,c.at+delta)};
        item.style.left=(next.at/total*100)+"%";
        item.style.width=(next.length/total*100)+"%";
      };
      const finish=run(async ev=>{
        if(ev.pointerId!==pointer)return;
        item.removeEventListener("pointermove",move);
        item.removeEventListener("pointerup",finish);
        item.removeEventListener("pointercancel",finish);
        if(!moved)return;
        item.dataset.moved="true";
        if(ev.type==="pointercancel") {paint();return;}
        selected=c.id;
        try { await commit(doc.clips.map(x=>x.id===c.id?next:x));seek(next.at); }
        catch(error){paint();throw error;}
      });
      item.addEventListener("pointermove",move);
      item.addEventListener("pointerup",finish);
      item.addEventListener("pointercancel",finish);
    });
    return item;
  }
  function tracks() {
    const total=scale();
    const head=()=>e("i",{cls:"playhead","aria-hidden":"true"});
    const dial=e("div",{cls:"ruler",onclick:laneClick},head());
    ruler(dial,total);
    const rows=[e("div",{cls:"track-row"},e("div",{cls:"track-label"},"时间"),dial)];
    for(const kind of kinds) {
      const clips=doc.clips.filter(c=>c.kind===kind);
      const lanes=[...new Set([0,...clips.map(c=>c.lane)])].sort((a,b)=>a-b);
      for(const index of lanes) {
        const lane=e("div",{cls:"lane",onclick:laneClick},...clips.filter(c=>c.lane===index).map(c=>clipNode(c,total)),head());
        rows.push(e("div",{cls:"track-row"},e("div",{cls:"track-label"},labels[kind]+(index?" "+(index+1):"")),lane));
      }
    }
    return e("div",{cls:"card track-shell"},...rows);
  }
  function fields() {
    const c=currentClip();
    if(!c)return e("p",{cls:"muted"},"点击片段可调整起止时间、音量或字幕，也可直接拖动。");
    const controls=[];
    const number=(label,value,key,step=.001)=>{
      const field=e("input",{type:"number",step,min:0,value,disabled:c.locked});
      controls.push({field,key});
      return e("label",{},label,field);
    };
    const inputs=[number("成片开始（秒）",c.at/1000,"at"),number("时长（秒）",c.length/1000,"length")];
    if(c.kind!=="caption") inputs.push(number("原片入点（秒）",c.from/1000,"from"),number("音量 %",c.volume*100,"volume",1));
    else {
      const field=e("textarea",{rows:2,value:c.text,disabled:c.locked});
      controls.push({field,key:"text"});
      inputs.push(e("label",{},"字幕",field));
    }
    const saveChanges=run(async()=>{
      const copy={...c};
      for(const {field,key} of controls) {
        if(key==="text") copy.text=field.value.trim();
        else {
          if(!field.value||!field.checkValidity())throw new Error("请输入有效的数值。");
          copy[key]=key==="volume"?Number(field.value)/100:ms(field.value);
        }
      }
      await commit(doc.clips.map(x=>x.id===c.id?copy:x));
    });
    return e("div",{cls:"fields card"},...inputs,
      btn("应用修改",saveChanges,"primary",{disabled:c.locked}),
      btn(c.locked?"解锁":"锁定片段",run(()=>commit(doc.clips.map(x=>x.id===c.id?{...x,locked:!x.locked}:x)))),
      btn("删除",run(()=>commit(doc.clips.filter(x=>x.id!==c.id))),"",{disabled:c.locked}));
  }

  function packageData() {
    return {schema:1,kind:"laoyu-creator-timeline",project,title:board.title,baseRevision:doc.revision,
      times:"milliseconds",...(desktopDataDirectory
        ? {mediaDirectory:desktopDataDirectory.replaceAll("\\","/")+"/projects/"+project+"/media/"}
        : {mediaBase:location.origin+endpoint(project,"media/")}),
      assets:board.assets,scenes:board.scenes,clips:doc.clips};
  }
  function exportPackage() {
    download("捞鱼视频创作台-"+project+"-时间线.json",JSON.stringify(packageData(),null,2));
  }
  function range() {
    const {start,end}=notesRange;
    if(start===""&&end==="")return null;
    const a=ms(start),b=ms(end);
    if(start===""||end===""||!Number.isSafeInteger(a)||!Number.isSafeInteger(b)||a<0||a>=b)
      throw new Error("请填写有效的修改起止时间。");
    return {start:a,end:b};
  }
  function promptText(kind,ticket) {
    const base="项目 "+board.title+"，ID "+project+"，基线 revision "+doc.revision+"。随附时间线 JSON 中的时间为毫秒。根据清单的本机 mediaDirectory（旧预览版为 mediaBase）和对应资产 file 的文件名读取素材。原片哈希和源入出点均在清单中。";
    if(kind==="draft") return base+"\n请用你已验证可用的剪映适配器，将画面、音频、普通字幕、源时间、轨道位置和音量输出成独立草稿副本。不可覆盖已有草稿。无法映射的字段单列。用当前剪映实测打开与可编辑后回传草稿目录。适配失败时回传剪辑单和素材映射，不声称草稿可用。";
    const rangeLabel=ticket.range?stamp(ticket.range.start,true)+"–"+stamp(ticket.range.end,true):"全时间线，仅处理明确请求";
    return base+"\n修改范围 "+rangeLabel+"。保留所有 locked=true 片段和范围外内容。需求："+notesRange.instruction.trim()+
      "\n请只返回 JSON：{\"schema\":1,\"project\":\""+project+"\",\"baseRevision\":"+doc.revision+
      ",\"ticket\":\""+ticket.id+"\",\"operations\":[{\"type\":\"update\",\"id\":\"片段ID\",\"fields\":{\"length\":2000}}]}。支持 update、remove（id）与 add（clip，沿用时间线完整字段并使用新 ID）。不要改变锁定内容或直接写入项目。";
  }
  async function copyPrompt(kind) {
    if(kind==="edit"&&!notesRange.instruction.trim())throw new Error("先填写要让 AI 修改的内容。");
    const ticket={id:newId(),project,baseRevision:doc.revision,range:kind==="edit"?range():null};
    const content=promptText(kind,ticket);
    if(kind==="edit")localStorage.setItem(handoffKey,JSON.stringify(ticket));
    try {await navigator.clipboard.writeText(content);notify("已复制 Agent 指令，请同时附上时间线包。");}
    catch{
      const textarea=e("textarea",{rows:10,value:content,readonly:""});
      const dialog=modal("Agent 指令",[textarea,btn("关闭",()=>dialog.close())]);
      textarea.select();
    }
  }
  async function loadPatch() {
    const [file]=await chooseFiles({accept:".json"});
    if(!file)return;
    const patch=await readJson(file);
    let ticket;
    try {ticket=JSON.parse(localStorage.getItem(handoffKey));}catch{}
    if(!ticket||patch.schema!==1||patch.project!==project||patch.ticket!==ticket.id||
      patch.baseRevision!==ticket.baseRevision||doc.revision!==ticket.baseRevision)
      throw new Error("回传文件与当前基线不匹配。请按当前时间线重新复制指令，人工改动仍保留。");
    const clips=applyOperations(doc.clips,patch.operations,board.assets,ticket.range);
    candidate={name:"Agent 候选",origin:"Agent",clips,operations:patch.operations,ticket,baseRevision:doc.revision};
    location.hash="#project/"+project+"/review";
    if(tab==="review")paint();
  }
  async function adopt() {
    if(!candidate)return;
    if(candidate.baseRevision!==doc.revision)throw new Error("时间线已变更，请重新导入或生成候选。");
    let clips=candidate.clips;
    if(candidate.operations) {
      const selectedOps=[...container.querySelectorAll(".diff-choice")].flatMap((field,index)=>field.checked?[candidate.operations[index]]:[]);
      clips=applyOperations(doc.clips,selectedOps,board.assets,candidate.ticket.range);
    }
    const v=snapshot(candidate.name,candidate.origin,clips);
    await commit(clips,true,v);
    compareId=v.id;candidate=null;paint();notify("已采用并保存为新版本。");
  }
  function draftFile(files) {return files.find(f=>f.name==="draft_content.json")??files.find(f=>f.name==="draft_info.json");}
  async function loadDraft(input) {
    let files=input?.files, draft=input?.draft;
    if(!files) files=await chooseFiles({folder:true});
    if(!files.length)return;
    const source=draftFile(files);
    if(!draft&&!source)throw new Error("未找到 draft_content.json 或 draft_info.json。");
    draft??=await readJson(source);
    const lookup=new Map();
    for(const f of files) lookup.set(f.name,lookup.has(f.name)?null:f);
    const materials=["videos","audios"].flatMap(group=>draft.materials?.[group]??[]);
    const nameOf=m=>(m.path??m.material_name??m.name??"").split(/[\\/]/).at(-1);
    const materialRefs=new Map();
    const missing=[];
    const used=new Set((draft.tracks??[]).flatMap(track=>(track.segments??[]).map(segment=>segment.material_id)));
    const unresolved=materials.filter(m=>used.has(m.id)&&nameOf(m)&&!lookup.get(nameOf(m)));
    if(unresolved.length&&window.confirm("有 "+unresolved.length+" 项素材位于草稿目录外。现在补选源文件？")) {
      const selected=await chooseFiles({multiple:true,accept:"video/*,audio/*,image/*,.mkv,.avi,.mov"});
      const picked=new Map();
      for(const f of selected) picked.set(f.name,picked.has(f.name)?null:f);
      for(const [name,file] of picked) if(file&&!lookup.get(name)) lookup.set(name,file);
    }
    for(const m of materials) {
      if(!used.has(m.id))continue;
      const name=nameOf(m);
      const file=lookup.get(name);
      if(file) {
        const found=board.assets.filter(a=>a.name===name&&a.bytes===file.size&&a.sha256);
        if(found.length===1) {
          try {
            await upload(project,file,{"X-Asset-Id":found[0].id,"X-Asset-Sha256":found[0].sha256});
            materialRefs.set(m.id,found[0]);continue;
          } catch {}
        }
        missing.push({m,file});
      }
    }
    if(missing.length&&window.confirm("将复制草稿目录中 "+missing.length+" 项素材到本机项目，继续？")) {
      const added=[];
      const known=new Map();
      for(const {m,file} of missing) {
        let a=known.get(file);
        if(!a) {
          a=await upload(project,file);
          known.set(file,a);
          added.push(a);
        }
        materialRefs.set(m.id,a);
      }
      const next={...board,assets:[...board.assets,...added]};
      const response=await post(endpoint(project,"board"),next);
      board={...next,revision:response.revision};
    }
    const result=parseDraft(draft,board.assets,m=>materialRefs.get(m.id));
    candidate={name:"剪映导入",origin:"剪映",clips:result.clips,warnings:result.warnings,baseRevision:doc.revision};
    location.hash="#project/"+project+"/review";
    if(tab==="review")paint();
    notify("草稿已读入候选，请核对差异和未映射项。");
  }
  function exchange() {
    const dialog=modal("剪映草稿交换",[
      e("p",{cls:"muted"},"11.6 原生往返待实测。可读取选定目录内的基础明文草稿。"),
      e("div",{cls:"row"},btn("导出为剪映草稿",()=>{},"",{disabled:true}),
        btn("选择草稿目录",run(async()=>{await loadDraft();dialog.close();}))),
      e("div",{cls:"row"},btn("复制 Agent 指令",run(()=>copyPrompt("draft")),"primary"),
        btn("导出时间线包",exportPackage),btn("关闭",()=>dialog.close()))
    ]);
  }
  function assist() {
    const instruction=e("textarea",{rows:2,placeholder:"例如：只缩短中段空档",value:notesRange.instruction,
      oninput:event=>notesRange.instruction=event.target.value});
    const rangeField=(name,label)=>e("label",{},label,e("input",{type:"number",min:0,step:.001,
      value:notesRange[name],placeholder:"秒",oninput:event=>notesRange[name]=event.target.value}));
    return e("section",{cls:"card assist"},e("div",{cls:"card-title"},e("h2",{},"让 AI 接着改"),e("span",{title:"保留人工锁定"},"🔒")),
      e("div",{cls:"range-fields"},rangeField("start","开始秒"),rangeField("end","结束秒")),
      e("label",{},"修改要求",instruction),
      e("div",{cls:"row"},btn("复制修改指令",run(()=>copyPrompt("edit")),"primary"),btn("时间线包",exportPackage)),
      e("div",{cls:"row"},btn("导入 Agent 建议",run(loadPatch))),
      e("p",{cls:"muted"},"回传建议先进入版本审阅。锁定片段保留。"),sticker("cheer"));
  }
  function paintTimeline() {
    previewA=preview(project,asset);
    const assets=e("section",{cls:"card"},e("div",{cls:"card-title"},e("h2",{},"素材"),btn("重新链接",run(relink))),
      e("div",{cls:"asset-list"},...board.assets.map(a=>btn("＋ "+a.name,run(()=>addAsset(a)))),
        !board.assets.length?e("p",{cls:"muted"},"先到素材画布导入原片。"):null),sticker("listen"));
    const generate=run(async()=>{
      if(doc.clips.some(c=>c.locked))throw new Error("当前时间线有锁定内容。请用选区修改或先解锁后重组整片。");
      if(doc.clips.length&&!window.confirm("用画布标记生成候选粗剪？当前时间线会保留，直到采用候选。"))return;
      const clips=roughCut(board);
      candidate={name:"画布标记粗剪",origin:"粗剪",clips,baseRevision:doc.revision};
      location.hash="#project/"+project+"/review";
    });
    const tools=e("div",{cls:"row editor-tools"},btn("按画布生成粗剪",generate,"primary"),
      btn("分割",run(()=>commit(splitClip(doc.clips,selected,playhead,board.assets)))),
      btn("＋ 字幕",run(addCaption)),btn("撤销",run(()=>history("undo")),"",{disabled:!undo.length}),
      btn("重做",run(()=>history("redo")),"",{disabled:!redo.length}),btn("保存版本",run(saveVersion),"",{disabled:!doc.clips.length}),
      btn("草稿交换",exchange),btn("－",()=>{zoom=Math.max(.25,zoom/2);paint();}),btn("＋",()=>{zoom=Math.min(4,zoom*2);paint();}));
    container.replaceChildren(e("div",{cls:"editor-top"},assets,player(previewA),assist()),tools,tracks(),fields());
  }
  function paintReview() {
    previewA=preview(project,asset);
    previewB=preview(project,asset,true);
    const v=selectedVersion();
    const versions=e("section",{cls:"card version-list"},e("h2",{},"版本列表"),
      ...doc.versions.map(version=>btn(version.name+" · "+version.origin,()=>{compareId=version.id;paint();},"",{"aria-pressed":String(v?.id===version.id)})),
      candidate?e("p",{cls:"muted"},"待采用 · "+candidate.name):null,
      !doc.versions.length?e("p",{cls:"muted"},"可从时间线保存版本。"):null);
    const review=e("section",{cls:"card"},e("div",{cls:"compare"},
      e("section",{},e("h3",{},candidate?candidate.name:"当前时间线"),player(previewA)),
      e("section",{},e("h3",{},v?.name??"当前时间线"),player(previewB,false))));
    if(candidate) {
      review.append(e("h3",{},"改动对照"),
        ...((candidate.operations??[]).map((op,i)=>e("label",{cls:"diff-row"},
          e("input",{cls:"diff-choice",type:"checkbox",checked:true,"aria-label":"采用改动 "+(i+1)}),
          ({update:"调整",remove:"移除",add:"新增"}[op.type])+" "+(doc.clips.find(c=>c.id===op.id)?.label||op.clip?.label||"片段")+
          (op.fields? " · "+Object.entries(op.fields).map(([k,val])=>({at:"位置",from:"入点",length:"时长",text:"字幕",volume:"音量",label:"标题",lane:"轨道",asset:"素材"}[k]??k)+" "+(["at","from","length"].includes(k)?stamp(val,true):String(val))).join(" / "):"")))),
        !candidate.operations?e("p",{cls:"muted"},candidate.clips.length+" 项候选片段 · "+stamp(durationOf(candidate.clips),true)):null,
        ...((candidate.warnings??[]).map(text=>e("p",{cls:"muted"},text))),
        e("div",{cls:"row"},btn("采用所选改动",run(adopt),"primary"),
          btn("丢弃候选",()=>{candidate=null;paint();})));
    } else {
      review.append(e("p",{cls:"muted"},"选择历史版本对照，可从时间线导入 Agent 建议。"));
      if(v && JSON.stringify(v.clips)!==JSON.stringify(doc.clips)) {
        review.append(btn("恢复为新版本",run(async()=>{
          if(!window.confirm("将所选版本恢复为新的当前时间线？现有版本仍可回看。"))return;
          const restore=snapshot("恢复 · "+v.name.slice(0,140),"人工",v.clips);
          await commit(v.clips,true,restore);compareId=restore.id;paint();
        })));
      }
    }
    const comment=e("textarea",{rows:3,placeholder:"给所选版本写批注","aria-label":"批注"});
    const notes=e("section",{cls:"card notes note-list"},e("h2",{},"批注"),
      ...(v?doc.notes.filter(n=>n.version===v.id).map(n=>btn(stamp(n.at,true)+" · "+n.text,()=>seek(n.at))):[]),
      v?comment:e("p",{cls:"muted"},"先保存一个成片版本，再添加时间批注。"),
      v?btn("添加批注",run(async()=>{
        const text=comment.value.trim();
        if(!text)return;
        const note={id:newId(),version:v.id,at:Math.min(playhead,durationOf(v.clips)),text:text.slice(0,4000)};
        await save({...doc,notes:[...doc.notes,note]});paint();
      })):null,
      sticker("salute"));
    container.replaceChildren(e("div",{cls:"review-grid"},versions,review,notes));
  }
  function paint() {
    if(!visible||!doc||!alive)return;
    const scroll=container.scrollTop;
    resetPreviews();
    if(tab==="review")paintReview();else paintTimeline();
    container.scrollTop=scroll;
    refreshFrame();
  }
  return {
    isSaving:()=>!!saving,
    wait:()=>saving?.catch(()=>{}),
    flush:()=>saving,
    dispose(){alive=false;visible=false;resetPreviews();},
    async show(next) {
      const serial=++showSerial;
      tab=next;
      visible=tab!=="board";
      container.hidden=!visible;
      if(!visible){resetPreviews();return;}
      const workspace=await request(endpoint(project,"workspace"));
      if(!alive||serial!==showSerial)return;
      if(doc&&doc.revision!==workspace.editor.revision){undo=[];redo=[];}
      ({board,editor:doc}=workspace);
      paint();
    },
    loadDraft
  };
}