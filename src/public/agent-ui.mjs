import { e, btn, link, sticker, request, post, notify, run, download, chooseFiles, readJson, modal } from "./studio.mjs";

const sourceRepo = "https://github.com/lyzbcy/laoyu-video-creator-studio";
const marketplaceRepo = "https://github.com/lyzbcy/laoyu-video-studio-marketplace";
const home = (title, detail) => e("header", { cls:"knowledge-heading" }, e("h1",{},title), e("p",{cls:"muted"},detail));
const field = (label, input) => e("label",{cls:"agent-field"},label,input);
const input = (placeholder="", max=140) => e("input",{type:"text",placeholder,maxlength:max});
const status = () => e("p",{role:"status",cls:"muted"});
const ext = (label, url) => e("a",{href:url,target:"_blank",rel:"noopener",cls:"action"},label);
const option = (value, label) => e("option",{value},label);
const saveJson = (name, value) => download(name,JSON.stringify(value,null,2));

async function copy(text) {
  try { await navigator.clipboard.writeText(text);notify("已复制，打开你的 Agent 粘贴即可。"); }
  catch {
    const content=e("textarea",{rows:12,value:text,readonly:"","aria-label":"待复制的 Agent 指令"});
    const dialog=modal("复制 Agent 指令",[content,btn("关闭",()=>dialog.close())]);
    content.select();
  }
}

export function agentPage() {
  const area=e("textarea",{rows:4,maxlength:1200,placeholder:"哪一步出现问题？如何复现？你预期看到什么？"});
  const extra=e("input",{type:"checkbox",checked:true});
  const preview=e("pre",{hidden:"",cls:"agent-output"});
  const summary=async()=>{
    const record=await request("/api/agent/diagnostics");
    if (!extra.checked) delete record.events;
    record.reproduction=area.value.trim();
    return record;
  };
  const instructions=async()=>copy([
    "请协助排障。使用下方诊断上下文，用隔离工作区复现，记录预期、实际、版本、最小复现和测试结果。",
    "源码仓库（需访问权限） " + sourceRepo,
    "先读 SKILL.md 和 docs/agent.md。只针对复现问题做最小修复，运行仓库指定回归；保留用户工程、配置及账号信息。",
    "修复后整理可审阅的差异和验证结果。用户授权后从独立分支提交 Draft PR，说明根因、复现、测试及适用版本；提交后回读链接。没有源码权限时，生成脱敏复现说明或补丁供维护者使用。",
    "诊断上下文（用户填写内容仅供本次排障，不要原样贴到 PR）",
    JSON.stringify(await summary(),null,2),
  ].join("\n"));
  return [home("Agent 排障","把版本、诊断记录和复现步骤交给你使用的 Agent，修复后走独立分支与 PR。"),
    e("section",{cls:"card agent-panel"},e("h2",{},"准备复现材料"),field("复现步骤（选填）",area),
      e("label",{cls:"check-line"},extra,"包含白名单诊断日志"),
      e("div",{cls:"row"},btn("预览诊断包",run(async()=>{preview.textContent=JSON.stringify(await summary(),null,2);preview.hidden=false;})),
        btn("导出诊断包",run(async()=>saveJson("捞鱼视频创作台-诊断包.json",await summary()))),
        btn("复制排障与 PR 指令",run(instructions),"primary")),preview),
    e("section",{cls:"card agent-panel"},e("h2",{},"修复交接"),
      e("p",{cls:"muted"},"先复现和测试，再由你决定是否让 Agent 提交草稿 PR。源码仓库仅向有权限的贡献者开放。"),
      e("div",{cls:"row"},ext("查看源码仓库",sourceRepo),link("设置与排障日志","#settings","action")))];
}

export function taggerSource(frame) {
  return new Promise((resolve,reject)=>{
    const id=crypto.randomUUID();
    const receive=event=>{
      if (event.origin!==location.origin || event.source!==frame.contentWindow || event.data?.type!=="studio-graph-source-result" || event.data.id!==id) return;
      clearTimeout(timeout);
      window.removeEventListener("message",receive);
      resolve(event.data.rows);
    };
    const timeout=setTimeout(()=>{window.removeEventListener("message",receive);reject(new Error("打标库仍在载入，请稍后重试。"));},4000);
    window.addEventListener("message",receive);
    frame.contentWindow.postMessage({type:"studio-graph-source",id},location.origin);
  });
}

function graphSvg(center, leaves) {
  const svg=(name,props,value="")=>{
    const node=document.createElementNS("http://www.w3.org/2000/svg",name);
    for(const [key,val] of Object.entries(props)) node.setAttribute(key,val);
    if(value)node.textContent=value;
    return node;
  };
  const diagram=svg("svg",{viewBox:"0 0 620 235",class:"tag-diagram",role:"img","aria-label":center+"的关联节点"});
  if(!leaves.length)return diagram;
  const short=value=>Array.from(value).slice(0,16).join("");
  leaves.slice(0,6).forEach((label,index)=>{
    const x=index%2?414:16,y=20+Math.floor(index/2)*75;
    diagram.append(svg("path",{d:`M310 116 Q${index%2?390:230} ${y+21}, ${x+95} ${y+21}`,stroke:"#d69c9a",fill:"none"}),
      svg("rect",{x,y,width:190,height:42,rx:12,fill:index%2?"#f2ebd8":"#f8dfd6"}),
      svg("text",{x:x+95,y:y+26,"text-anchor":"middle",fill:"#452138","font-size":12},short(label)));
  });
  diagram.append(svg("rect",{x:225,y:93,width:170,height:46,rx:14,fill:"#452138"}),
    svg("text",{x:310,y:122,"text-anchor":"middle",fill:"white","font-size":13},short(center)));
  return diagram;
}

export function graphPage(initial) {
  let graph=initial, focus="";
  const viewport=e("div",{cls:"graph-content"});
  const query=input("例如 悬疑铺垫、人物登场、节奏感");
  query.setAttribute("aria-label","搜索曲目或场景");
  const flash=status();
  const redraw=()=>{
    const terms=query.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const matches=sample=>terms.every(term=>sample.toLowerCase().includes(term));
    const tags=graph.tags.filter(tag=>!terms.length || matches(tag.key)).slice(0,24);
    const tag=graph.tags.find(tag=>tag.key===focus);
    const clips=graph.tracks.filter(track=>(!tag || tag.tracks.includes(track.id)) && matches([track.title,track.titleHint?.value||"",track.note,...track.tags.map(tag=>tag.group+" "+tag.label)].join(" ")));
    const lookup=new Map(graph.tracks.map(track=>[track.id,track]));
    const rules=graph.insights.filter(rule=>matches([rule.scene,rule.kind,rule.reason,rule.cue].join(" ")) &&
      (!tag || rule.evidence.some(item=>tag.tracks.includes(item.track))));
    viewport.replaceChildren(
      e("section",{cls:"card"},e("h2",{},"原始打标"),e("p",{cls:"muted"},`${graph.tracks.length} 条曲目 · ${graph.tags.length} 个标签${graph.tracks.some(item=>item.available!==undefined)?` · ${graph.tracks.filter(item=>item.available===true).length} 条已关联音源`:""}`),
        e("div",{cls:"row graph-tags"},btn("全部",()=>{focus="";redraw();},"",{"aria-pressed":String(!focus)}),
          ...tags.map(tag=>btn(tag.key+" · "+tag.tracks.length,()=>{focus=tag.key;redraw();},"",{"aria-pressed":String(focus===tag.key)}))),
        graph.tracks.length?graphSvg(tag?.key||"BGM 标签",tag?clips.map(track=>track.title):tags.map(item=>item.key)):e("p",{cls:"muted"},"先同步打标记录、导入 JSONL，或在商城下载曲库并加入图谱。")),
      e("section",{cls:"card"},e("h2",{},"Agent 内化规则"),
        graph.outdated?e("p",{cls:"muted"},"打标来源已变动，请按当前版本重新内化。"):null,
        !rules.length?e("p",{cls:"muted"},"当前没有可显示的规则。导入 Agent 建议后会显示场景、用法和证据。"):null,
        ...rules.map(rule=>e("details",{cls:"evidence-row"},e("summary",{},`${rule.kind} · ${rule.scene}`),e("p",{},rule.reason),
          rule.cue?e("p",{cls:"muted"},"入点／剪辑提示　"+rule.cue):null,
          e("ul",{},...rule.evidence.map(item=>e("li",{},lookup.get(item.track)?.title+" · 「"+item.quote+"」")))))),
      e("section",{cls:"card"},e("h2",{},"关联曲目"),
        ...clips.slice(0,24).map(track=>e("details",{cls:"evidence-row"},e("summary",{},track.title+(track.available===false?" · 音源缺失":"")),
          e("p",{cls:"muted"},[track.kind,...track.tags.map(tag=>tag.label)].join(" · ")),track.note?e("p",{},track.note):null,
          track.titleHint?e("p",{cls:"muted"},`剪映曲名线索 (${track.titleHint.weight}) · ${track.titleHint.value}`):null)),
        clips.length>24?e("p",{cls:"muted"},"已显示前 24 条，可继续按标签或搜索缩小范围。"):null));
  };
  query.oninput=()=>{focus="";redraw();};
  const payload=()=>({schema:1,revision:graph.revision,tracks:graph.tracks});
  const requireTracks=()=>{if(!graph.tracks.length)throw new Error("请先加入一份有标签或备注的曲库。");};
  const guide=["根据我导出的 BGM 证据包内化用法。标签和备注是人工证据（权重 1.0），场景和搭配是你的推断。曲名线索（权重 0.35）仅用于找待试听候选，不可单独作证据。",
    "优先分析叙事时机、音乐与音效叠放、哪里应留白、哪些情况下慎用。不要凭空补写听感、节拍或音源授权。",
    "只返回 JSON，保持 revision 不变。每条用法写场景、入点或切法、理由以及逐字引用的证据。搭配须至少引用两首。",
    '{"schema":1,"revision":"原 revision","insights":[{"scene":"人物登场","kind":"适合","cue":"揭示时进","reason":"说明依据","evidence":[{"track":"原 track.id","quote":"逐字引用的标签或备注片段"}]}]}',
    "kind 只允许 适合、慎用、搭配。不要替换原曲目或标签。"].join("\n");
  redraw();
  return [home("BGM 知识图谱","从情绪、场景和剪辑节拍找音乐。每条 Agent 规则都保留曲目与原文证据。"),
    e("section",{cls:"card agent-panel"},e("div",{cls:"row"},link("去 BGM 打标同步","#library","action"),
      btn("导入标签 JSONL",run(async()=>{
        const [file]=await chooseFiles({accept:".jsonl"});if(!file)return;
        if(file.size>4*1024*1024)throw new Error("标签库最大 4 MB。");
        graph=await post("/api/knowledge/source",{source:"file",rows:await file.text()});focus="";redraw();flash.textContent="已载入标签库。";
      })),link("逛曲库商城","#market","action")),
      e("div",{cls:"row"},btn("导出标签证据包",run(()=>{requireTracks();saveJson("BGM-标签证据包.json",payload());})),
        btn("复制内化指令",run(async()=>{requireTracks();await copy(guide);}),"primary"),
        btn("导入 Agent 图谱",run(async()=>{
          const [file]=await chooseFiles({accept:".json"});if(!file)return;
          graph=await post("/api/knowledge/curation",await readJson(file));redraw();flash.textContent="已校验证据并保存 Agent 规则。";
        })),btn("复制选曲指令",run(async()=>{
          requireTracks();
          const queryText=query.value.trim();
          const pack={schema:1,revision:graph.revision,tags:graph.tags,insights:graph.insights,tracks:graph.tracks};
          saveJson("BGM-选曲图谱.json",pack);
          await copy(`请结合随附 BGM 图谱，为「${queryText||"我给你的分镜"}」挑选 BGM 和音效。注明适用镜头、进出点、降音量或留白的位置与具体曲目 ID。使用人工标签和备注（权重 1.0），参考 Agent 规则及剪映曲名（权重 0.35），仅按曲名的候选标为需试听。实际剪辑候选跳过 available=false 的条目，并列出引用和不确定处。`);
        }))),flash,query),viewport];
}

function submission() {
  const type=e("select",{"aria-label":"资源类型"},option("skill","Skill ZIP"),option("bgm","BGM 标签 JSONL"));
  const name=input("资源名称");
  const id=input("例如 rhythm-cut",80);
  const author=input("作者或团队");
  const version=input("例如 1.0.0",50);
  const url=input("GitHub Release 或 GitHub Raw 下载地址",400);
  const description=e("textarea",{rows:3,maxlength:400});
  const file=e("input",{type:"file",accept:".zip,.jsonl","aria-label":"与下载地址对应的文件"});
  const result=status();
  let entry;
  const instruction=btn("复制投稿与 PR 指令",run(async()=>{
    if(!entry)throw new Error("请先生成清单。");
    await copy([`请为 ${marketplaceRepo} 准备免费资源投稿。`,"核对公开下载地址可达、SHA-256 与授权。Fork 后新建分支，将下面条目追加到 catalog.json 的 entries，检查 ID 唯一。用户同意后提交 PR，附资源来源、授权及验证记录。",JSON.stringify(entry,null,2)].join("\n"));
  }));
  const save=btn("导出资源条目",()=>{if(entry)saveJson(entry.id+"-market-entry.json",entry);});
  instruction.disabled=save.disabled=true;
  const build=e("button",{type:"submit",cls:"primary"},"生成上架清单");
  const form=e("form",{cls:"feedback-form"},field("资源类型",type),field("资源名称",name),field("资源 ID",id),field("作者",author),
    field("版本",version),field("说明",description),field("公开下载链接",url),field("选择本地文件以计算 SHA-256",file),
    e("p",{cls:"muted"},"选择文件只用于本机计算校验值。提交到社区后，经审核合并才对其他用户可见。"),result,
    e("div",{cls:"row"},build,save,instruction,ext("社区投稿仓库",marketplaceRepo)));
  form.oninput=()=>{entry=null;instruction.disabled=save.disabled=true;result.textContent="";};
  form.onsubmit=run(async event=>{
    event.preventDefault();
    if(build.disabled)return;
    const chosen=file.files[0];
    const maximum=type.value==="skill"?24:4;
    if(!chosen||chosen.size>maximum*1024*1024||!chosen.name.toLowerCase().endsWith(type.value==="skill"?".zip":".jsonl"))throw new Error(`请选择匹配的文件，大小不能超过 ${maximum} MB。`);
    build.disabled=true;
    try {
      const bytes=await crypto.subtle.digest("SHA-256",await chosen.arrayBuffer());
      const sha256=Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,"0")).join("");
      entry=await post("/api/market/submission",{id:id.value.trim(),type:type.value,name:name.value.trim(),author:author.value.trim(),
        version:version.value.trim(),description:description.value.trim(),url:url.value.trim(),sha256});
      instruction.disabled=save.disabled=false;
      result.textContent="上架条目已生成，可以导出或交给 Agent 投稿。";
    } finally {build.disabled=false;}
  });
  const dialog=modal("上架免费资源",[form,btn("关闭",()=>dialog.close())]);
}

export function marketPage(initial) {
  let catalog=initial, filter="all";
  const items=e("div",{cls:"market-grid"});
  const feedback=status();
  const redraw=()=>items.replaceChildren(...catalog.items.filter(item=>filter==="all" || item.type===filter).map(item=>{
    const get=item.localSkill?null:btn(item.downloaded?"重新下载":"免费下载",run(async()=>{
      get.disabled=true;
      feedback.textContent="正在下载并校验「"+item.name+"」…";
      try {
        await post(`/api/market/${item.id}/download`,{});
        item.downloaded=true;
        redraw();
        feedback.textContent="「"+item.name+"」已下载。";
      } catch(error) {feedback.textContent=error.message;}
      finally {get.disabled=false;}
    }),item.downloaded?"":"primary");
    const useLocal=item.localSkill?btn("复制本机使用指令",run(()=>copy(`使用已安装的 ${item.id}。先读取这个本机 Skill 入口和它引用的文件：\n${item.localSkill.path}\n根据我接下来提供的任务执行。`)),"primary"):null;
    const save=item.downloaded?e("a",{cls:"action",href:`/api/market/${item.id}/asset`,download:""},"导出资源文件"):null;
    const use=item.downloaded && item.type==="bgm"?btn("加入知识图谱",run(async()=>{
      await post(`/api/market/${item.id}/use`,{});location.hash="#graph";
    }),"primary"):null;
    return e("article",{cls:"card market-card"},e("div",{cls:"market-card-head"},sticker(item.type==="skill"?"ready":"listen"),
      e("div",{},e("small",{cls:"muted"},(item.type==="skill"?"Skill":"BGM 标签")+" · 免费"),e("h2",{},item.name),
        e("p",{cls:"muted"},item.author+" · "+(item.localSkill?"本机版本":item.version)))),e("p",{},item.description),
      e("p",{cls:"muted"},item.localSkill?"已连接本机 · 使用当前已安装的 Skill":item.downloaded?(item.type==="skill"?"已下载 · 导出 ZIP 后可交给 Agent 使用":"已下载 · 可加入本机图谱"):"尚未下载"),
      e("div",{cls:"row"},useLocal,get,save,use));
  }));
  redraw();
  return [home("Skill 商城","已安装的 Skill 自动连接。其余视频工作流和 BGM 标签按需下载。"),
    e("div",{cls:"row market-actions"},...[["all","全部"],["skill","Skills"],["bgm","BGM 打标库"]].map(([value,label])=>btn(label,()=>{filter=value;redraw();})),
      btn("刷新社区",run(async event=>{
        const button=event.currentTarget;
        button.disabled=true;feedback.textContent="正在读取社区资源目录…";
        try {catalog=await request("/api/market?refresh=1");redraw();feedback.textContent=catalog.warning||"已刷新社区资源。";}
        finally {button.disabled=false;}
      })),btn("上架免费资源",submission,"accent")),feedback,items];
}
