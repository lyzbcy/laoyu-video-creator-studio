import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { app, BrowserWindow, Menu, dialog, safeStorage, session, shell } from "electron";
import { validateWebhook } from "./feedback.mjs";

const name = "捞鱼视频创作台";
const defaultData = process.platform === "win32"
  ? path.join(process.env.LOCALAPPDATA || app.getPath("home"), "LaoyuCreatorStudio")
  : path.join(app.getPath("appData"), "LaoyuCreatorStudio");
const data = path.resolve(process.env.LAOYU_STUDIO_DATA || defaultData);
app.setName(name);
app.setPath("userData", path.join(data, "desktop-profile"));
if (process.platform === "win32") app.setAppUserModelId("Laoyu.CreatorStudio");

const feedbackFile = path.join(data, "feedback-webhook.bin");
let window, stop, stopping = false;
const configure = process.argv.indexOf("--configure-feedback");
if (configure !== -1) {
  app.whenReady().then(() => configureFeedback(process.argv[configure + 1])).then(() => app.exit(0), () => app.exit(1));
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  app.on("window-all-closed", () => app.quit());
  app.on("will-quit", event => {
    if (!stop || stopping) return;
    event.preventDefault();
    stopping = true;
    stop().finally(() => app.quit());
  });
  app.whenReady().then(open).catch(error => {
    const message = error.code === "EADDRINUSE"
      ? "创作台端口已被占用。请关闭旧版本后重试。"
      : error.message;
    dialog.showErrorBox(name + "启动失败", message);
    app.quit();
  });
}

async function configureFeedback(specification) {
  if (!specification || (await fs.stat(specification)).size > 64 * 1024) throw new Error("反馈配置文件无效。");
  const text = await fs.readFile(specification, "utf8");
  const endpoint = text.match(/https:\/\/qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?key=[a-zA-Z0-9_-]+/);
  const webhook = validateWebhook(endpoint?.[0]);
  if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error("系统凭证存储不可用。");
  const encrypted = await safeStorage.encryptStringAsync(webhook);
  await fs.mkdir(data, { recursive: true });
  const temp = feedbackFile + "." + randomBytes(8).toString("hex") + ".tmp";
  try {
    await fs.writeFile(temp, encrypted, { flag: "wx", mode: 0o600 });
    await fs.rename(temp, feedbackFile);
  } finally {
    await fs.unlink(temp).catch(() => {});
  }
}

async function readWebhook() {
  try {
    if ((await fs.stat(feedbackFile)).size > 4096) return undefined;
    const encrypted = await fs.readFile(feedbackFile);
    const { result } = await safeStorage.decryptStringAsync(encrypted);
    return validateWebhook(result);
  } catch { return undefined; }
}

async function open() {
  process.env.LAOYU_STUDIO_DATA = data;
  const { startStudio } = await import("./server.mjs");
  const desktopKey = randomBytes(32).toString("hex");
  const service = await startStudio({ desktopKey, webhook: await readWebhook() });
  stop = service.stop;
  const { origin } = service;
  const isOwn = url => {
    try { return new URL(url).origin === origin; }
    catch { return false; }
  };
  if (process.platform !== "darwin") Menu.setApplicationMenu(null);
  const main = new BrowserWindow({
    title: name,
    width: 1440,
    height: 950,
    minWidth: 760,
    minHeight: 620,
    show: false,
    backgroundColor: "#f8f4ec",
    icon: fileURLToPath(new URL("./public/logo.png", import.meta.url)),
    ...(process.platform === "win32" ? {
      titleBarStyle: "hidden",
      titleBarOverlay: { color: "#452138", symbolColor: "#ffffff", height: 52 }
    } : {}),
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
  });
  window = main;
  const { webContents } = main;
  const permissions = new Set(["fileSystem", "clipboard-sanitized-write", "clipboard-read", "fullscreen"]);
  const desktopSession = session.defaultSession;
  desktopSession.webRequest.onBeforeSendHeaders({ urls: [origin + "/*"] }, (details, callback) => {
    if (details.webContentsId === webContents.id && isOwn(details.url)) {
      details.requestHeaders["X-Studio-Desktop"] = desktopKey;
    }
    callback({ requestHeaders: details.requestHeaders });
  });
  desktopSession.setPermissionCheckHandler((contents, permission, requestingOrigin) =>
    contents === webContents && permissions.has(permission) && isOwn(requestingOrigin));
  desktopSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(contents === webContents && permissions.has(permission) && isOwn(details.requestingUrl || contents.getURL()));
  });
  webContents.setWindowOpenHandler(({url}) => {
    if (/^https:\/\/github\.com\/lyzbcy\/laoyu-video-(?:creator-studio|studio-marketplace)\/?$/.test(url)) {
      void shell.openExternal(url).catch(() => {});
    }
    return { action: "deny" };
  });
  webContents.on("will-frame-navigate", event => {
    if (!isOwn(event.url)) event.preventDefault();
  });
  webContents.on("will-redirect", (event, url) => {
    if (!isOwn(url)) event.preventDefault();
  });

  let closing = false;
  let flushed = false;
  main.on("close", async event => {
    if (flushed || webContents.isCrashed()) return;
    event.preventDefault();
    if (closing) return;
    closing = true;
    try {
      await webContents.executeJavaScript("window.flushStudioWindow?.()");
      flushed = true;
      main.close();
    } catch {
      dialog.showMessageBoxSync(main, {
        type: "warning", title: name, message: "项目改动尚未保存，请处理页面上的保存提示后再关闭。"
      });
    } finally {
      closing = false;
    }
  });
  main.once("ready-to-show", () => main.show());
  main.once("closed", () => { window = undefined; });
  try {
    await main.loadURL(origin);
  } catch (error) {
    main.destroy();
    throw error;
  }
}
