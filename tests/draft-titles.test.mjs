import test from "node:test";
import assert from "node:assert/strict";
import titles from "../src/tagger/draft-titles.js";
import {libraryRows,sourceGraph,validateInsights} from "../src/knowledge.mjs";

const raw="1234567890abcdef1234567890abcdef";
const duplicate="1234567890abcdef1234567890abcdee";

test("draft titles require a full track identity and reject conflicting or placeholder names",()=>{
  const fallback={[raw]:{title:"旧标题",author:"作者"},[duplicate]:{title:"未命名项目"}};
  const lookup=titles.titleLookup(fallback,{titles:{[raw]:"鼓点进行曲"}});
  assert.deepEqual(lookup.find(raw),{title:"鼓点进行曲",author:"作者",vip:undefined,mid:undefined,titleSource:"jianying-draft"});
  assert.equal(lookup.find("12345678"),undefined);
  assert.equal(lookup.find(duplicate),undefined);
  assert.equal(titles.titleLookup(fallback,{titles:{[raw]:"鼓点进行曲"},conflicts:[raw]}).find(raw),undefined);
});

test("known names bring untagged tracks into search without becoming manual evidence",()=>{
  const tracks=libraryRows([{id:raw,file:raw+".mp3",kind:"music",titleHint:{source:"jianying-draft",value:"鼓点进行曲",weight:1}}]);
  assert.equal(tracks.length,1);
  assert.deepEqual(tracks[0].titleHint,{source:"jianying-draft",value:"鼓点进行曲",weight:0.35});
  const graph=sourceGraph({tagger:tracks});
  assert.equal(graph.tags.length,0);
  assert.throws(()=>validateInsights({schema:1,revision:graph.revision,insights:[{scene:"示例",kind:"适合",reason:"示例",evidence:[{track:tracks[0].id,quote:"进行曲"}]}]},graph),/找不到/);
});
