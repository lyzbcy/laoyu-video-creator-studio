import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {createMarketplace} from "../src/market.mjs";

test("market links an installed official skill without downloading it",async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"studio-skill-link-"));
  assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const skills=path.join(root,"skills"), id="software-video-production";
  const folder=path.join(skills,id), entry=path.join(folder,"SKILL.md");
  await fs.mkdir(folder,{recursive:true});
  await fs.writeFile(entry,"---\nname: "+id+"\ndescription: fixture\n---\n");
  const market=createMarketplace(root,[{id,type:"skill",name:"测试",author:"作者",version:"1",description:"测试",
    url:"https://github.com/example/skills/releases/download/v1/example.zip",sha256:"a".repeat(64)}],
    {skillRoots:[skills],fetcher:async()=>{throw new Error("unexpected network");}});
  const catalog=await market.catalog(false);
  assert.equal(catalog.items[0].downloaded,false);
  assert.deepEqual(catalog.items[0].localSkill,{path:entry});
  await fs.writeFile(entry,"---\nname: different-skill\n---\n");
  assert.equal((await market.catalog(false)).items[0].localSkill,null);
});
