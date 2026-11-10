import test from "node:test";
import assert from "node:assert/strict";
import {makeClip,roughCut,splitClip,applyOperations,parseDraft,validateClips} from "../src/public/timeline.mjs";

const video={id:"source",name:"原片.mp4",mime:"video/mp4",duration:12,annotations:[{start:2,end:6,sceneId:"01"}]};
const audio={id:"audio",name:"音乐.wav",mime:"audio/wav",duration:10};
const assets=[video,audio];

test("source ranges become composition intervals with distinct source offsets",()=>{
 const board={assets,scenes:[{id:"01",title:"开场",text:"开始",clips:[]}]};
 const [shot,caption]=roughCut(board);
 assert.deepEqual([shot.at,shot.from,shot.length,caption.at,caption.length],[0,2000,4000,0,4000]);
 const [left,right,subtitle]=splitClip([shot,caption],shot.id,1300,assets);
 assert.deepEqual([left.length,right.from,right.at,right.length,subtitle.text],[1300,3300,1300,2700,"开始"]);
});

test("Agent cannot rewrite locks or change pieces outside its range",()=>{
 const a=makeClip("video",{asset:video.id,locked:true,length:1000});
 const b=makeClip("video",{asset:video.id,at:1000,from:1000,length:2000});
 const base=[a,b];
 const range={start:1000,end:3000};
 assert.throws(()=>applyOperations(base,[{type:"update",id:a.id,fields:{length:800}}],assets,range),/锁定/);
 assert.throws(()=>applyOperations(base,[{type:"update",id:b.id,fields:{at:900}}],assets,range),/选区/);
 const revised=applyOperations(base,[{type:"update",id:b.id,fields:{length:1700}}],assets,range);
 assert.deepEqual(revised[0],a);
 assert.equal(revised[1].length,1700);
 assert.equal(base[1].length,2000);
});

test("base Jianying plaintext tracks preserve offsets, volume and subtitle text",()=>{
 const timeline={materials:{videos:[{id:"v",path:"原片.mp4"}],audios:[{id:"a",path:"音乐.wav"}],texts:[{id:"s",content:'{"text":"字幕"}'}]},
   tracks:[["video","v"],["audio","a"],["text","s"]].map(([type,id])=>({type,segments:[{material_id:id,
     source_timerange:{start:2000000},target_timerange:{start:1000000,duration:2500000},volume:.45}]}))};
 const result=parseDraft(timeline,assets,m=>assets.find(a=>a.name===m.path));
 assert.deepEqual(result.clips.map(c=>[c.kind,c.at,c.length]),[["video",1000,2500],["audio",1000,2500],["caption",1000,2500]]);
 assert.equal(result.clips[1].volume,.45);
 assert.equal(result.clips[2].text,"字幕");
 assert.throws(()=>parseDraft({},assets,()=>{}),/明文草稿/);
});

test("invalid overlaps and media-kind changes cannot be saved",()=>{
 const a=makeClip("video",{asset:video.id,length:1000});
 assert.throws(()=>validateClips([a,makeClip("video",{asset:video.id,at:900,length:900})],assets),/重叠/);
 assert.throws(()=>validateClips([makeClip("video",{asset:audio.id})],assets),/类型/);
});
