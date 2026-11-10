import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { libraryRows } from "./knowledge.mjs";

export const repository = "lyzbcy/laoyu-video-studio-marketplace";
const indexUrl = `https://raw.githubusercontent.com/${repository}/main/catalog.json`;
const limit = 24 * 1024 * 1024;
const idPattern = /^[a-z0-9][a-z0-9-]{1,79}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const sourcePattern = /^https:\/\/(?:github\.com\/[\w.-]+\/[\w.-]+\/releases\/download\/[\w.-]+|raw\.githubusercontent\.com\/[\w.-]+\/[\w.-]+\/[\w.-]+(?:\/[\w.-]+)*)\/[\w.-]+$/;
const downloadHosts = new Set(["github.com", "raw.githubusercontent.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"]);
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

export function validateEntry(entry) {
  if (!entry || !idPattern.test(entry.id || "") || !["skill", "bgm"].includes(entry.type) ||
      !["name", "author", "description", "version"].every(key => typeof entry[key] === "string" && entry[key].trim() && entry[key].length <= 400) ||
      !hashPattern.test(entry.sha256 || "") || !sourcePattern.test(entry.url || "") ||
      !entry.url.endsWith(entry.type === "skill" ? ".zip" : ".jsonl")) throw fail("资源清单无效，需提供可下载的 GitHub 文件和 SHA-256。");
  const { id, type, name, author, description, version, url, sha256 } = entry;
  return { id, type, name, author, description, version, url, sha256 };
}

async function getBytes(url, maximum, fetcher) {
  const signal = AbortSignal.timeout(30000);
  for (let count = 0; count < 4; count++) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || !downloadHosts.has(parsed.hostname)) throw fail("资源跳转地址不受支持。");
    const response = await fetcher(url, { signal, redirect: "manual" });
    if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.has("location")) {
      await response.body?.cancel();
      url = new URL(response.headers.get("location"), url).href;
      continue;
    }
    if (!response.ok || !response.body || Number(response.headers.get("content-length")) > maximum) {
      await response.body?.cancel();
      throw fail("资源下载失败或文件超出大小限制。", 502);
    }
    const parts = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > maximum) throw fail("资源文件超出大小限制。");
      parts.push(chunk);
    }
    return Buffer.concat(parts, size);
  }
  throw fail("资源地址跳转次数过多。", 502);
}

export function createMarketplace(data, official, { fetcher = fetch } = {}) {
  const root = path.join(data, "market-downloads");
  let remote = new Map();
  const builtIn = new Map(official.map(validateEntry).map(entry => [entry.id, entry]));
  const entries = () => new Map([...builtIn, ...remote]);
  const location = entry => path.join(root, entry.id + "-" + entry.sha256 + (entry.type === "skill" ? ".zip" : ".jsonl"));
  const verified = bytes => createHash("sha256").update(bytes).digest("hex");

  async function asset(id) {
    const entry = entries().get(id);
    if (!entry) throw fail("未找到资源。");
    const file = location(entry);
    const stat = await fs.stat(file).catch(() => null);
    if (!stat?.isFile() || stat.size > limit) throw fail("请先下载资源。", 404);
    const bytes = await fs.readFile(file);
    if (verified(bytes) !== entry.sha256) throw fail("已下载文件发生变化，请重新下载。", 409);
    return { entry, bytes };
  }

  return {
    async catalog(refresh) {
      let warning = "";
      if (refresh) {
        try {
          const payload = JSON.parse(await getBytes(indexUrl, 200000, fetcher));
          if (payload.schema !== 1 || !Array.isArray(payload.entries) || payload.entries.length > 100) throw fail("社区目录格式无效。");
          const checked = new Map();
          for (const value of payload.entries) {
            const entry = validateEntry(value);
            if (checked.has(entry.id)) throw fail("社区目录含重复 ID。");
            checked.set(entry.id, entry);
          }
          remote = checked;
          await fs.mkdir(root, { recursive: true });
          await fs.writeFile(path.join(root,"catalog-cache.json"), JSON.stringify([...remote.values()]));
        } catch { warning = "社区目录暂时无法更新，保留上次目录和官方资源。"; }
      } else if (!remote.size) {
        try {
          const cached = JSON.parse(await fs.readFile(path.join(root,"catalog-cache.json"),"utf8"));
          if (Array.isArray(cached) && cached.length <= 100) remote = new Map(cached.map(validateEntry).map(entry=>[entry.id,entry]));
        } catch { /* Catalog remains usable offline. */ }
      }
      const items = await Promise.all([...entries().values()].map(async entry => ({ ...entry,
        downloaded: await fs.stat(location(entry)).then(stat => stat.isFile(), () => false) })));
      return { items, warning, repository };
    },
    async download(id) {
      const entry = entries().get(id);
      if (!entry) throw fail("未找到资源，请先刷新目录。");
      let bytes;
      try { bytes = await getBytes(entry.url, entry.type === "bgm" ? 4*1024*1024 : limit, fetcher); }
      catch (error) {
        if (error.status) throw error;
        throw fail("下载连接失败或超时，请检查网络后重试。", 502);
      }
      if (verified(bytes) !== entry.sha256) throw fail("下载校验失败，资源未加入本机。", 502);
      if (entry.type === "bgm") {
        if (!libraryRows(bytes.toString("utf8")).length) throw fail("打标库里没有可识别的记录。");
      } else if (bytes.length < 4 || bytes.readUInt32LE(0) !== 0x04034b50) throw fail("Skill 资源不是有效的 ZIP 文件。");
      await fs.mkdir(root, { recursive: true });
      const file = location(entry);
      const temp = file + "." + randomBytes(8).toString("hex") + ".tmp";
      try {
        await fs.writeFile(temp, bytes, { flag:"wx" });
        await fs.rename(temp, file);
      } finally { await fs.unlink(temp).catch(() => {}); }
      return entry;
    },
    asset,
  };
}
