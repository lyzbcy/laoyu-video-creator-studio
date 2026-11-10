import fs from "node:fs/promises";
import path from "node:path";

const events = new Set([
  "studio_started", "studio_stopped", "media_imported", "project_created", "board_saved", "timeline_saved",
  "feedback_sent", "feedback_failed", "request_failed", "diagnostics_on", "diagnostics_off", "request",
]);
const validEntry = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z) ([a-z_]+)(?: (\d{3}) (\d{1,8})ms)?$/;
const limit = 256 * 1024;

export function createDiagnostics(data) {
  const file = path.join(data, "studio.log");
  const previous = path.join(data, "studio.previous.log");
  let buffer = [];
  let writing = Promise.resolve();
  let detailed = false;

  function flush() {
    writing = writing.then(async () => {
      if (!buffer.length) return;
      const batch = buffer;
      buffer = [];
      const payload = batch.join("\n") + "\n";
      try {
        const { size = 0 } = await fs.stat(file).catch(error => {
          if (error.code === "ENOENT") return {};
          throw error;
        });
        if (size + Buffer.byteLength(payload) > limit) await fs.rename(file, previous);
        await fs.appendFile(file, payload, "utf8");
      } catch {
        buffer = [...batch, ...buffer].slice(-256);
      }
    });
    return writing;
  }

  function record(event, { urgent = false, status, milliseconds } = {}) {
    if (!events.has(event)) return;
    const timing = Number.isInteger(status) && Number.isFinite(milliseconds)
      ? ` ${status} ${Math.min(99999999, Math.max(0, Math.round(milliseconds)))}ms` : "";
    buffer.push(new Date().toISOString() + " " + event + timing);
    if (buffer.length > 256) buffer.shift();
    if (urgent || buffer.length >= 32) void flush();
  }

  async function read(filePath) {
    const handle = await fs.open(filePath, "r").catch(() => null);
    if (!handle) return "";
    try {
      const { size } = await handle.stat();
      const length = Math.min(size, limit);
      const { buffer: bytes, bytesRead } = await handle.read(Buffer.alloc(length), 0, length, size - length);
      return bytes.toString("utf8", 0, bytesRead);
    } catch { return ""; }
    finally { await handle.close(); }
  }

  const timer = setInterval(() => void flush(), 3000);
  timer.unref();
  return {
    record,
    get detailed() { return detailed; },
    setDetailed(enabled) {
      detailed = enabled;
      record(enabled ? "diagnostics_on" : "diagnostics_off");
    },
    async recent() {
      await flush();
      const [older, current] = await Promise.all([read(previous), read(file)]);
      return [older, current, ...buffer].join("\n").split("\n").filter(line => {
        const match = validEntry.exec(line);
        return match && events.has(match[2]);
      }).slice(-60).join("\n");
    },
    stop() {
      clearInterval(timer);
      record("studio_stopped");
      return flush();
    },
  };
}
