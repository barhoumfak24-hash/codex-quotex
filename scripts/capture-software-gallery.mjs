import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const root = resolve(process.cwd());
const outputDir = join(root, "public", "quotex-software-screens");
const profileDir = join(root, ".tmp-edge-gallery-profile");
const port = 9337;
const viewport = { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false };

const pages = [
  ["dashboard.png", "http://localhost:5174/employee", 0],
  ["client-record.png", "http://localhost:5174/employee/clients/customer_demo", 0],
  ["ai-quoting.png", "http://localhost:5174/employee/clients/customer_demo", 1500],
  ["policy-detail.png", "http://localhost:5174/employee/policies/policy_home", 0],
  ["billing-detail.png", "http://localhost:5174/employee/billing/policy_home", 0],
  ["claims.png", "http://localhost:5174/employee/claims", 0],
  ["marketing.png", "http://localhost:5174/employee/marketing", 0],
  ["calendar.png", "http://localhost:5174/employee/calendar", 0],
];

await mkdir(outputDir, { recursive: true });
await mkdir(profileDir, { recursive: true });

const edge = spawn(edgePath, [
  "--headless=new",
  "--disable-gpu",
  "--hide-scrollbars",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profileDir}`,
  `--window-size=${viewport.width},${viewport.height}`,
  "about:blank",
], {
  stdio: ["ignore", "ignore", "pipe"],
});

let edgeError = "";
edge.stderr.on("data", (chunk) => {
  edgeError += chunk.toString();
});

try {
  await waitForDevtools(port);
  const tab = await createTab(port);
  const cdp = await connectCdp(tab.webSocketDebuggerUrl);

  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", viewport);
  await navigateAndWait(cdp, "http://localhost:5174/");
  await cdp.send("Runtime.evaluate", {
    expression: `
      localStorage.setItem("quotex.auth.userId.v1", "user_manager_pc");
      localStorage.setItem("quotex.tenantId.v1", "agency_palmcoast");
      localStorage.setItem("quotex.galleryCapture.v1", "true");
    `,
  });

  for (const [fileName, url, scrollTop] of pages) {
    await navigateAndWait(cdp, url);
    await cdp.send("Runtime.evaluate", {
      expression: `window.scrollTo({ top: ${scrollTop}, left: 0, behavior: "instant" });`,
    });
    await sleep(1800);
    const result = await cdp.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    });
    await writeFile(join(outputDir, fileName), Buffer.from(result.data, "base64"));
    console.log(`captured ${fileName}`);
  }

  await cdp.close();
} finally {
  edge.kill();
  setTimeout(() => {
    if (!edge.killed) edge.kill("SIGKILL");
  }, 500);
}

if (edgeError && /ERR_|ERROR/i.test(edgeError)) {
  console.error(edgeError.split("\n").slice(-5).join("\n"));
}

async function waitForDevtools(portNumber) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${portNumber}/json/version`);
      if (response.ok) return;
    } catch {
      // Edge is still starting.
    }
    await sleep(250);
  }
  throw new Error("Timed out waiting for Edge devtools.");
}

async function createTab(portNumber) {
  const response = await fetch(`http://127.0.0.1:${portNumber}/json/new?about:blank`, {
    method: "PUT",
  });
  if (!response.ok) throw new Error(`Unable to create tab: ${response.status}`);
  return response.json();
}

async function connectCdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    ws.addEventListener("open", resolveOpen, { once: true });
    ws.addEventListener("error", rejectOpen, { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  const listeners = new Map();

  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve: resolveMessage, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolveMessage(message.result ?? {});
      return;
    }
    if (message.method && listeners.has(message.method)) {
      for (const listener of listeners.get(message.method)) listener(message.params ?? {});
    }
  });

  return {
    send(method, params = {}) {
      const id = nextId++;
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise((resolveMessage, reject) => {
        pending.set(id, { resolve: resolveMessage, reject });
      });
    },
    once(method) {
      return new Promise((resolveEvent) => {
        const listener = (params) => {
          listeners.set(
            method,
            (listeners.get(method) ?? []).filter((candidate) => candidate !== listener)
          );
          resolveEvent(params);
        };
        listeners.set(method, [...(listeners.get(method) ?? []), listener]);
      });
    },
    close() {
      ws.close();
    },
  };
}

async function navigateAndWait(cdp, url) {
  const loaded = Promise.race([cdp.once("Page.loadEventFired"), sleep(5500)]);
  await cdp.send("Page.navigate", { url });
  await loaded;
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}
