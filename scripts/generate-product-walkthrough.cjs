const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "public", "training");
const videoPath = path.join(outDir, "quotex-complete-product-walkthrough.webm");
const narrationPath = path.join(outDir, "quotex-complete-product-walkthrough.wav");
const narrationTextPath = path.join(outDir, "quotex-complete-product-walkthrough-narration.txt");
const baseUrl = process.env.QUOTEX_BASE_URL || "http://localhost:5174";

const scenes = [
  {
    route: "/employee",
    title: "Dashboard command center",
    caption:
      "Start every workday on the dashboard. Reminders, notifications, prospect queue, recent status, and activity visibility tell staff what needs attention first.",
    focus: [0.28, 0.28],
  },
  {
    route: "/employee/tasks",
    title: "Activity Center",
    caption:
      "Activities are the operating queue. Open the card, review due date and importance, complete the required work, then resolve only when the file is genuinely clear.",
    focus: [0.42, 0.48],
  },
  {
    route: "/employee/messages",
    title: "Messages mirror the outside inbox",
    caption:
      "Messages are organized by clients, prospects, holders, carriers, and internal threads. Staff can open the matching thread in their email app and keep the record trail intact.",
    focus: [0.5, 0.42],
  },
  {
    route: "/employee/prospects",
    title: "Prospect queue",
    caption:
      "Use the boxy filters and search first. Each row shows status, last action, managed-by, and a single Open action so the agent reviews context before acting.",
    focus: [0.52, 0.52],
  },
  {
    route: "/employee/clients",
    title: "Client roster",
    caption:
      "Clients are split by useful operating filters, including personal and commercial lines. Commercial clients show the business name with the contact underneath.",
    focus: [0.44, 0.44],
  },
  {
    route: "/employee/clients/customer_demo",
    title: "Client dashboard",
    caption:
      "The client dashboard is the unified file. Policies, billing, claims, documents, remarks, activities, marketing history, and timelines stay tied to one client record.",
    focus: [0.52, 0.46],
  },
  {
    route: "/employee/clients/customer_demo",
    title: "AI quoting workspace",
    caption:
      "For quoting, select personal or commercial lines first. Then provide the asset details AI needs: address, VIN, usage, values, operations, and missing fields.",
    focus: [0.34, 0.72],
  },
  {
    route: "/employee/policies",
    title: "Policy rows",
    caption:
      "Policies are listed by policy number, with asset context underneath. The only row action is Open; detailed actions live on the full policy page.",
    focus: [0.54, 0.5],
  },
  {
    route: "/employee/policies/policy_home",
    title: "Policy detail and documents",
    caption:
      "Policy pages combine overview, coverage, documents, holders, and timeline. Documents can be selected and sent to the client or holders with PDFs attached.",
    focus: [0.54, 0.48],
  },
  {
    route: "/employee/billing",
    title: "Billing visibility",
    caption:
      "Billing is informational, not payment collection. Each policy has its own row showing how the client pays the carrier, plan, next due, status, and history.",
    focus: [0.54, 0.5],
  },
  {
    route: "/employee/claims",
    title: "Claims and loss runs",
    caption:
      "Claims track carrier status and agency follow-up. Previous loss runs can be generated, sent to clients, holders, or carriers, and downloaded as a clean PDF.",
    focus: [0.52, 0.48],
  },
  {
    route: "/employee/documents",
    title: "Template library and e-sign rules",
    caption:
      "Document review is a template library for staff. Managers can lock settings, mark templates required or not required, and set customer or agent e-sign rules.",
    focus: [0.55, 0.5],
  },
  {
    route: "/employee/renewals",
    title: "Renewals and carrier downloads",
    caption:
      "Renewals prepare the next term without publishing early. Carrier downloads bring in renewal updates for review before they change the client or policy record.",
    focus: [0.52, 0.5],
  },
  {
    route: "/employee/marketing",
    title: "AI marketing",
    caption:
      "AI marketing drafts branded pamphlets, audiences, and campaigns. The agency logo and contact details carry through so every campaign feels agency-owned.",
    focus: [0.48, 0.52],
  },
  {
    route: "/employee/calendar",
    title: "Calendar and daily agenda",
    caption:
      "Calendar opens in week view. Personal reminders, company reminders, activity due dates, internal meeting requests, and events appear in one operating calendar.",
    focus: [0.52, 0.48],
  },
  {
    route: "/employee/accounting",
    title: "Accounting and timesheets",
    caption:
      "Accounting lets agents submit personal timesheets and lets managers configure who receives the timesheet schedule, review submissions, and reconcile agency information.",
    focus: [0.5, 0.48],
  },
  {
    route: "/employee/analytics",
    title: "Analytics and goals",
    caption:
      "Analytics shows personal or agency-wide goals depending on role. Agents can request goals; managers receive the request as a notification, not as an activity.",
    focus: [0.5, 0.48],
  },
  {
    route: "/employee/training",
    title: "Training and portal assistant",
    caption:
      "Training videos are role-specific, searchable by chapter, and linked by the portal assistant. Ask a niche software question and the assistant can link the exact lesson.",
    focus: [0.5, 0.48],
  },
];

function ensureDir() {
  fs.mkdirSync(outDir, { recursive: true });
}

function narrationText() {
  return [
    "Welcome to the Quotex Insurance complete product walkthrough. This training teaches the full software workflow from the perspective of agency staff.",
    ...scenes.map((scene, index) => `Section ${index + 1}. ${scene.title}. ${scene.caption}`),
    "That is the full operating rhythm. Start from the dashboard, open the exact record, keep every action attached to the right client, policy, claim, billing record, or activity, and use training chapters whenever a staff member needs a precise how-to.",
  ].join(" ");
}

function generateNarration() {
  fs.writeFileSync(narrationTextPath, narrationText(), "utf8");
  const psCommand = [
    "Add-Type -AssemblyName System.Speech;",
    `$text = Get-Content -Raw ${JSON.stringify(narrationTextPath)};`,
    "$voice = New-Object System.Speech.Synthesis.SpeechSynthesizer;",
    "$voice.Rate = 5;",
    "$voice.Volume = 100;",
    `$voice.SetOutputToWaveFile(${JSON.stringify(narrationPath)});`,
    "$voice.Speak($text);",
    "$voice.Dispose();",
  ].join(" ");
  execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", psCommand], {
    stdio: "inherit",
  });
}

async function captureScreens() {
  const browser = await chromium.launch({ headless: true, channel: "msedge" }).catch(() =>
    chromium.launch({ headless: true })
  );
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  await context.addInitScript(() => {
    window.localStorage.setItem("quotex.auth.userId.v1", "user_manager_pc");
  });
  const page = await context.newPage();
  const captured = [];

  for (const scene of scenes) {
    await page.goto(`${baseUrl}${scene.route}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(900);
    await page.addStyleTag({
      content: `
        * { caret-color: transparent !important; }
        body { scroll-behavior: auto !important; }
        .fixed.bottom-0, [aria-label="Ask AI"], button:has(svg + span) { animation: none !important; }
      `,
    }).catch(() => {});
    const image = await page.screenshot({ type: "jpeg", quality: 82, fullPage: false });
    captured.push({
      ...scene,
      imageDataUrl: `data:image/jpeg;base64,${image.toString("base64")}`,
    });
    console.log(`Captured ${scene.title}`);
  }

  await browser.close();
  return captured;
}

async function recordVideo(captured) {
  const browser = await chromium.launch({ headless: true, channel: "msedge" }).catch(() =>
    chromium.launch({ headless: true })
  );
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  fs.writeFileSync(videoPath, Buffer.alloc(0));
  await page.exposeBinding("pushVideoChunk", async (_source, base64) => {
    fs.appendFileSync(videoPath, Buffer.from(base64, "base64"));
  });
  await page.setContent("<!doctype html><html><body style='margin:0;background:#050504'></body></html>");

  const result = await page.evaluate(async ({ scenes, audioDataUrl }) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    document.body.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas rendering unavailable.");

    function loadImage(src) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
      });
    }

    function ease(value) {
      return value < 0.5 ? 2 * value * value : 1 - Math.pow(-2 * value + 2, 2) / 2;
    }

    function wrap(text, maxWidth, font) {
      ctx.font = font;
      const words = text.split(/\s+/);
      const lines = [];
      let line = "";
      for (const word of words) {
        const test = line ? `${line} ${word}` : word;
        if (ctx.measureText(test).width > maxWidth && line) {
          lines.push(line);
          line = word;
        } else {
          line = test;
        }
      }
      if (line) lines.push(line);
      return lines.slice(0, 3);
    }

    function drawCover(img, local, focus) {
      const zoom = 1.015 + ease(local) * 0.035;
      const srcRatio = img.width / img.height;
      const dstRatio = 1280 / 720;
      let sw = img.width;
      let sh = img.height;
      if (srcRatio > dstRatio) sw = img.height * dstRatio;
      else sh = img.width / dstRatio;
      sw /= zoom;
      sh /= zoom;
      const maxX = img.width - sw;
      const maxY = img.height - sh;
      const sx = Math.max(0, Math.min(maxX, maxX * (focus[0] ?? 0.5)));
      const sy = Math.max(0, Math.min(maxY, maxY * (focus[1] ?? 0.5)));
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, 1280, 720);
    }

    function roundedRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    function drawFrame(img, scene, index, local, totalProgress) {
      drawCover(img, local, scene.focus);
      const gradient = ctx.createLinearGradient(0, 0, 0, 720);
      gradient.addColorStop(0, "rgba(0,0,0,0.18)");
      gradient.addColorStop(0.56, "rgba(0,0,0,0.08)");
      gradient.addColorStop(1, "rgba(0,0,0,0.76)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 1280, 720);

      ctx.fillStyle = "rgba(5,5,4,0.82)";
      roundedRect(34, 34, 430, 86, 18);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.font = "700 24px Arial";
      ctx.fillText("Quotex Insurance", 98, 72);
      ctx.fillStyle = "rgba(255,255,255,0.68)";
      ctx.font = "600 13px Arial";
      ctx.fillText("Complete software product walkthrough", 98, 96);
      ctx.fillStyle = "#050504";
      roundedRect(52, 51, 44, 44, 10);
      ctx.fill();
      ctx.fillStyle = "#d8bd6d";
      ctx.font = "36px Georgia";
      ctx.fillText("Q", 62, 86);

      const x = 54 + (scene.focus[0] ?? 0.5) * 1170;
      const y = 120 + (scene.focus[1] ?? 0.5) * 430;
      ctx.strokeStyle = "rgba(216,189,109,0.92)";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(x, y, 20 + Math.sin(local * Math.PI * 2) * 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "rgba(216,189,109,0.22)";
      ctx.beginPath();
      ctx.arc(x, y, 32, 0, Math.PI * 2);
      ctx.fill();

      roundedRect(48, 508, 1184, 150, 24);
      ctx.fillStyle = "rgba(5,5,4,0.86)";
      ctx.fill();
      ctx.strokeStyle = "rgba(216,189,109,0.35)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = "#d8bd6d";
      ctx.font = "700 14px Arial";
      ctx.fillText(`SECTION ${index + 1} OF ${scenes.length}`, 84, 548);
      ctx.fillStyle = "#ffffff";
      ctx.font = "700 32px Arial";
      ctx.fillText(scene.title, 84, 589);
      ctx.fillStyle = "rgba(255,255,255,0.83)";
      const lines = wrap(scene.caption, 1040, "500 24px Arial");
      lines.forEach((line, lineIndex) => ctx.fillText(line, 84, 625 + lineIndex * 30));

      ctx.fillStyle = "rgba(255,255,255,0.16)";
      roundedRect(48, 678, 1184, 10, 5);
      ctx.fill();
      ctx.fillStyle = "#d8bd6d";
      roundedRect(48, 678, 1184 * totalProgress, 10, 5);
      ctx.fill();
    }

    const images = await Promise.all(scenes.map((scene) => loadImage(scene.imageDataUrl)));
    const videoStream = canvas.captureStream(30);
    let audioDuration = 0;

    const perSceneMs = Math.max(
      5600,
      Math.min(7200, ((audioDuration || 0) * 1000 + 900) / scenes.length)
    );
    const totalMs = Math.ceil(perSceneMs * scenes.length);
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : MediaRecorder.isTypeSupported("video/webm;codecs=vp8")
        ? "video/webm;codecs=vp8"
        : "video/webm";
    const recorder = new MediaRecorder(videoStream, {
      mimeType,
      videoBitsPerSecond: 1200000,
      audioBitsPerSecond: 128000,
    });
    const chunks = [];
    const pendingWrites = [];
    async function blobToBase64(blob) {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      return btoa(binary);
    }
    recorder.ondataavailable = (event) => {
      if (!event.data.size) return;
      chunks.push(event.data.size);
      pendingWrites.push(blobToBase64(event.data).then((base64) => window.pushVideoChunk(base64)));
    };

    const done = new Promise((resolve) => {
      recorder.onstop = async () => {
        await Promise.all(pendingWrites);
        resolve({ mimeType, chunkCount: chunks.length, size: chunks.reduce((sum, size) => sum + size, 0) });
      };
    });

    recorder.start(1000);
    const start = performance.now();

    await new Promise((resolve) => {
      function tick(now) {
        const elapsed = now - start;
        const sceneIndex = Math.min(scenes.length - 1, Math.floor(elapsed / perSceneMs));
        const local = Math.min(1, Math.max(0, (elapsed - sceneIndex * perSceneMs) / perSceneMs));
        const totalProgress = Math.min(1, elapsed / totalMs);
        drawFrame(images[sceneIndex], scenes[sceneIndex], sceneIndex, local, totalProgress);
        if (elapsed < totalMs) requestAnimationFrame(tick);
        else resolve();
      }
      requestAnimationFrame(tick);
    });

    await new Promise((resolve) => setTimeout(resolve, 320));
    recorder.stop();
    return done;
  }, { scenes: captured, audioDataUrl: "" });

  await browser.close();
  return { ...result, size: fs.statSync(videoPath).size };
}

(async () => {
  ensureDir();
  if (process.env.QUOTEX_GENERATE_NARRATION === "1") generateNarration();
  const captured = await captureScreens();
  const result = await recordVideo(captured);
  console.log(`Wrote ${videoPath}`);
  console.log(`MIME ${result.mimeType}, ${Math.round(result.size / 1024 / 1024)} MB`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
