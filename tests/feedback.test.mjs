import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "creator-feedback-test-"));
process.env.LAOYU_STUDIO_DATA = root;
process.env.LAOYU_STUDIO_DISABLE_DISCOVERY = "1";
const { startStudio, version } = await import("../src/server.mjs");
const webhook = "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=synthetic-fixture-key";

test("feedback uses verified version and optional redacted diagnostics and respects WeCom responses", async t => {
  assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
  const legacy = "2026-11-10T12:00:00.000Z /private/project-path";
  await fs.writeFile(path.join(root, "studio.log"), legacy + "\n2026-11-10T12:00:00.000Z media_imported\n");
  const deliveries = [];
  let release;
  const held = new Promise(resolve => { release = resolve; });
  let entered;
  const firstEntered = new Promise(resolve => { entered = resolve; });
  const transport = async (url, request) => {
    assert.equal(url, webhook);
    assert.equal(request.redirect, "error");
    assert.equal(request.method, "POST");
    const body = JSON.parse(request.body);
    assert.equal(body.msgtype, "text");
    deliveries.push(body.text.content);
    if (deliveries.length === 1) {
      entered();
      await held;
      return Response.json({ errcode: 40001, errmsg: "opaque upstream data" });
    }
    return Response.json({ errcode: 0 });
  };
  const app = await startStudio({ port: 0, desktopKey: "fixture", webhook, feedbackFetcher: transport });
  t.after(async () => {
    try { await app.stop(); }
    finally { await fs.rm(root, { recursive: true, force: true }); }
  });
  const { origin } = app;
  const auth = { "x-studio-desktop": "fixture" };
  const get = route => fetch(origin + route, { headers: auth });
  const { token } = await (await get("/api/projects")).json();
  const post = (route, payload, headers = {}) => fetch(origin + route, {
    method: "POST", headers: { ...auth, origin, "content-type": "application/json", "x-board-token": token, ...headers },
    body: JSON.stringify(payload),
  });
  const info = await (await get("/api/feedback")).json();
  assert.equal(info.configured, true);
  assert.doesNotMatch(JSON.stringify(info), /synthetic-fixture-key|private\/project-path/);
  assert.match(info.logPreview, /media_imported/);
  assert.equal((await fetch(origin + "/api/feedback")).status, 403);
  assert.equal((await post("/api/feedback", {}, { "x-board-token": "invalid" })).status, 403);
  assert.equal((await post("/api/feedback", { message: " " })).status, 400);
  assert.equal((await post("/api/feedback", { message: "fixture", category: "unknown" })).status, 400);
  const summary = "剪".repeat(480);
  const first = post("/api/feedback", { message: summary, includeLogs: false });
  await firstEntered;
  try {
    assert.equal((await post("/api/feedback", { message: "duplicate" })).status, 429);
  } finally { release(); }
  const rejected = await first;
  assert.equal(rejected.status, 502);
  assert.doesNotMatch(await rejected.text(), /opaque upstream data|synthetic-fixture-key/);
  assert.doesNotMatch(deliveries[0], /诊断摘要|media_imported/);
  const success = await post("/api/feedback", { message: summary, category: "素材导入", includeLogs: true, version: "fake-version" });
  assert.equal(success.status, 200);
  assert.match(deliveries[1], /捞鱼视频创作台.*用户反馈/);
  assert.ok(deliveries[1].includes("版本 " + version));
  assert.ok(deliveries[1].includes(summary));
  assert.match(deliveries[1], /素材导入/);
  assert.match(deliveries[1], /media_imported/);
  assert.doesNotMatch(deliveries[1], /fake-version|private\/project-path/);
  assert.ok(Buffer.byteLength(deliveries[1]) <= 2048);
  assert.equal((await post("/api/feedback", { message: "duplicate after success" })).status, 429);
  assert.equal((await (await get("/logs")).json()).detailed, false);
  assert.equal((await post("/api/diagnostics", { enabled: true })).status, 200);
  await get("/health");
  const log = await (await get("/logs")).json();
  assert.equal(log.detailed, true);
  assert.match(log.text, /request 200 \d+ms/);
  assert.doesNotMatch(log.text, /private\/project-path|synthetic-fixture-key/);
});
