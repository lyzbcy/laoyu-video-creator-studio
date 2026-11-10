import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createMarketplace, validateEntry } from "../src/market.mjs";
import { libraryRows, sourceGraph, validateInsights } from "../src/knowledge.mjs";

const corpus = [
  { id:"a", file:"C:\\local\\雨声.mp3", kind:"ambient", tags:{ 场景:["夜晚"] }, note:"雨声适合作为低音量底噪" },
  { id:"b", file:"悬疑.mp3", kind:"music", tags:{ 情绪:["紧张"] }, note:"适合人物潜入时低音量进入" },
  { id:"c", file:"已移除.mp3", kind:"music", tags:{ 情绪:["紧张"] }, excluded:true },
];

test("graph preserves tagged evidence and rejects hallucinated, stale or one-track pairings", () => {
  const tracks=libraryRows(corpus);
  assert.equal(tracks.length,2);
  assert.equal(tracks.find(item=>item.kind==="ambient").title,"雨声.mp3");
  const graph=sourceGraph({file:tracks});
  assert.equal(graph.tags.length,2);
  const [a,b]=tracks;
  const rule={scene:"潜入",kind:"搭配",cue:"先底噪后音乐",reason:"用底噪衬托行动",evidence:[
    {track:a.id,quote:a.note},{track:b.id,quote:b.note},
  ]};
  const candidate={schema:1,revision:graph.revision,insights:[rule]};
  const verified=validateInsights(candidate,graph);
  assert.deepEqual(sourceGraph({file:tracks},{...candidate,insights:verified}).insights,[rule]);
  assert.throws(()=>validateInsights({...candidate,insights:[{...rule,evidence:[rule.evidence[0]]}]},graph),/两首/);
  assert.throws(()=>validateInsights({...candidate,insights:[{...rule,evidence:[{track:a.id,quote:"不存在"},rule.evidence[1]]}]},graph),/找不到/);
  const next=sourceGraph({file:[a]},candidate);
  assert.equal(next.outdated,true);
  assert.equal(next.insights.length,0);
  assert.throws(()=>validateInsights(candidate,next),/已变化/);
  assert.equal(sourceGraph({file:tracks,"market:sample":tracks}).revision,graph.revision);
});

test("marketplace opens empty, downloads only on request, verifies bytes and rejects unsafe URLs", async t=>{
  const base=path.resolve(os.tmpdir());
  const root=await fs.mkdtemp(path.join(base,"studio-market-test-"));
  assert.equal(path.dirname(path.resolve(root)),base);
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const payload=Buffer.from(corpus.map(row=>JSON.stringify(row)).join("\n"));
  const entry={id:"bgm-sample",type:"bgm",name:"标签样例",author:"样例",version:"1",description:"示例",
    url:"https://raw.githubusercontent.com/lyzbcy/sample/main/library.jsonl",sha256:createHash("sha256").update(payload).digest("hex")};
  assert.throws(()=>validateEntry({...entry,url:"https://bad.test/library.jsonl"}),/GitHub/);
  assert.throws(()=>validateEntry({...entry,id:"../file"}),/无效/);
  let calls=0, result=payload;
  const market=createMarketplace(root,[entry],{fetcher:async()=>{calls++;return new Response(result);}});
  assert.equal((await market.catalog(false)).items[0].downloaded,false);
  assert.equal(calls,0);
  await assert.rejects(market.asset(entry.id),/先下载/);
  result=Buffer.from("tampered");
  await assert.rejects(market.download(entry.id),/校验失败/);
  assert.equal((await market.catalog(false)).items[0].downloaded,false);
  result=payload;
  await market.download(entry.id);
  assert.equal((await market.catalog(false)).items[0].downloaded,true);
  assert.deepEqual((await market.asset(entry.id)).bytes,payload);
  const community={...entry,id:"community-bgm"};
  result=Buffer.from(JSON.stringify({schema:1,entries:[community]}));
  assert.equal((await market.catalog(true)).items.length,2);
  const offline=createMarketplace(root,[entry],{fetcher:async()=>{throw new Error("offline");}});
  assert.equal((await offline.catalog(false)).items.length,2);
});
