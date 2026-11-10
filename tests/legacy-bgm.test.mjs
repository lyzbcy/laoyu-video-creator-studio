import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import library from "../src/tagger/legacy-library.js";

const id="11112222333344445555666677778888";
const old={id,file:"老标签_11112222.wav",kind:"sfx",tags:{情绪:["紧张"]},note:"旧备注"};

test("read-only legacy sync keeps local edits and applies upstream changes to untouched records",()=>{
  const state={records:{},tracks:{},groups:[{name:"情绪",tags:["平静"]}],legacyBaseline:{},legacyGroups:{}};
  const set=record=>library.mergeLegacyTags(state,{records:[record],groups:[{name:"情绪",tags:["紧张"]}]});
  assert.equal(set(old),true);
  assert.equal(state.tracks[id].kind,"sfx");
  assert.deepEqual(state.groups[0].tags,["平静","紧张"]);
  assert.equal(set({...old,note:"旧库更新"}),true);
  state.records[id].note="创作台里的修改";
  assert.equal(set({...old,note:"不同的新备注"}),false);
  assert.equal(state.records[id].note,"创作台里的修改");
  state.groups[0].tags.pop();
  set(old);
  assert.deepEqual(state.groups[0].tags,["平静"]);
});

test("desktop manifest exposes existing labels and only their matching legacy audio",async t=>{
  const base=path.resolve(os.tmpdir());
  const data=await fs.mkdtemp(path.join(base,"studio-legacy-bgm-"));
  assert.equal(path.dirname(path.resolve(data)),base);
  let app;
  t.after(async()=>{try {await app?.stop();} finally {await fs.rm(data,{recursive:true,force:true});}});
  process.env.LAOYU_STUDIO_DATA=data;
  process.env.LAOYU_STUDIO_DISABLE_DISCOVERY="1";
  const audio=path.join(data,"existing-audio"), file=path.join(data,"bgm_library.jsonl");
  await fs.mkdir(audio);
  const input=JSON.stringify({_meta:"schema",groups:[{name:"情绪",tags:["紧张"]}]})+"\n"+
    JSON.stringify(old)+"\n"+JSON.stringify({id:"__proto__",file:"invalid.wav"})+"\n";
  await fs.writeFile(file,"\uFEFF"+input);
  await fs.writeFile(path.join(data,"legacy-bgm.json"),JSON.stringify({library:file,audioDirs:[audio]}));
  const name="旧文件_11112222.wav";
  const buffer=Buffer.alloc(60);
  buffer.write("RIFF",0); buffer.writeUInt32LE(52,4); buffer.write("WAVEfmt ",8);
  buffer.writeUInt32LE(16,16); buffer.writeUInt16LE(1,20); buffer.writeUInt16LE(1,22);
  buffer.writeUInt32LE(8000,24); buffer.writeUInt32LE(16000,28); buffer.writeUInt16LE(2,32); buffer.writeUInt16LE(16,34);
  buffer.write("data",36); buffer.writeUInt32LE(16,40);
  await fs.writeFile(path.join(audio,name),buffer);
  await fs.writeFile(path.join(audio,"私人素材.wav"),buffer);
  const {startStudio}=await import("../src/server.mjs");
  app=await startStudio({port:0,desktopKey:"test-key"});
  const get=(route,headers={})=>fetch(app.origin+route,{headers:{"x-studio-desktop":"test-key",...headers}});
  const manifest=await (await get("/manifest.json")).json();
  assert.equal(manifest.legacy.records.length,1);
  assert.equal(manifest.legacy.records[0].note,"旧备注");
  assert.equal(manifest.files.length,1);
  assert.equal(manifest.files[0].legacyId,id);
  assert.equal(manifest.files[0].name,name);
  const audioResult=await get(manifest.files[0].url,{Range:"bytes=0-3"});
  assert.equal(audioResult.status,206);
  assert.equal(await audioResult.text(),"RIFF");
  assert.equal((await get("/music/"+encodeURIComponent("私人素材.wav"))).status,404);
  assert.equal((await fetch(app.origin+"/manifest.json")).status,403);
  assert.equal(await fs.readFile(file,"utf8"),"\uFEFF"+input);
});
