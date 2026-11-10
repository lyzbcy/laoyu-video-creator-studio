import { Buffer } from "node:buffer";

export const categories = ["素材导入", "画布和批注", "剪辑和版本", "剪映草稿", "BGM 打标", "功能建议", "其他"];

export function validateWebhook(value) {
  const url = value?.trim();
  if (!/^https:\/\/qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?key=[a-zA-Z0-9_-]{16,128}$/.test(url)) {
    throw new Error("企业微信机器人地址格式无效。");
  }
  return url;
}

function failure(status, message) {
  return Object.assign(new Error(message), { status });
}

export function feedbackLog(summary) {
  const recent = [];
  let size = 0;
  for (const line of summary.split("\n").reverse()) {
    if (!line) continue;
    size += Buffer.byteLength(line) + 1;
    if (size > 350) break;
    recent.unshift(line);
  }
  return recent.join("\n");
}

export function createFeedback({ version, webhook, readLogs, fetcher = fetch }) {
  if (webhook) webhook = validateWebhook(webhook);
  let sending = false;
  let lastSent = 0;
  return {
    configured: Boolean(webhook),
    async send(input) {
      if (!webhook) throw failure(503, "此设备尚未配置企业微信反馈机器人。");
      const message = typeof input?.message === "string" ? input.message.trim() : "";
      const category = input?.category || "";
      if (!message || message.length > 480) throw failure(400, "请填写 1 至 480 字的留言。");
      if (category && !categories.includes(category)) throw failure(400, "请选择有效的问题类别。");
      if (sending || Date.now() - lastSent < 10000) throw failure(429, "请等待上一条反馈发送完成，稍后再试。");

      sending = true;
      try {
        const header = ["捞鱼视频创作台 · 用户反馈", "版本 " + version, "平台 " + process.platform + " / " + process.arch,
          category && "类别 " + category, "", "留言"].filter(Boolean).join("\n") + "\n";
        let content = header + message;
        if (input.includeLogs === true) {
          const recent = feedbackLog(await readLogs());
          if (recent) content += "\n\n最近的诊断摘要\n" + recent;
        }
        const result = await fetcher(webhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ msgtype: "text", text: { content } }),
          redirect: "error",
          signal: AbortSignal.timeout(10000),
        });
        if (!result.ok || (await result.json()).errcode !== 0) throw new Error();
        lastSent = Date.now();
      } catch {
        throw failure(502, "企业微信未确认收到。请检查网络或联系开发者核对机器人配置后重试。");
      } finally {
        sending = false;
      }
    },
  };
}
