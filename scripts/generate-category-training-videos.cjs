const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const outputDir = path.join(root, "public", "training", "categories");
const tempDir = path.join(root, ".tmp-training-recordings");
const baseUrl = process.env.QUOTEX_BASE_URL || "http://localhost:5174";

const categories = [
  {
    slug: "dashboard",
    route: "/employee",
    title: "Dashboard",
    narration:
      "Dashboard is the daily command center. Start by checking reminders, notifications, and the prospect queue, then scan recent status updates and the performance cards. If a card needs action, open it from here so the back path and context stay clean. The goal is to decide what needs attention before jumping into client, policy, billing, claim, or activity work.",
  },
  {
    slug: "activity-center",
    route: "/employee/tasks",
    title: "Activity Center",
    narration:
      "Activity Center is the work queue for assigned follow up. Open one card at a time, check the client or policy context, confirm the due date and importance, then use the action buttons for profile, documents, carrier portal, reminders, reassignment, or resolution. Resolve only when the required work is actually complete so the activity trail stays accurate.",
  },
  {
    slug: "messages",
    route: "/employee/messages",
    title: "Messages",
    narration:
      "Messages mirrors the agency communication record. Use the contact list for clients, prospects, holders, carriers, and internal threads, then keep email and SMS tied to the correct record. The open-in-app action should take staff to the relevant Gmail, Outlook, or external thread, while the portal keeps a searchable copy attached to the client, prospect, carrier, or holder.",
  },
  {
    slug: "prospects",
    route: "/employee/prospects",
    title: "Prospects",
    narration:
      "Prospects is where started quotes, abandoned submissions, nurtured leads, and converted opportunities are managed. Start with the status filters and search bar, then read the last action, current status, and managed by column before opening a row. Keep the row action simple: open the prospect first, then assign, message, quote, convert, or archive from the detail view.",
  },
  {
    slug: "clients",
    route: "/employee/clients",
    detailRoute: "/employee/clients/customer_demo",
    title: "Clients",
    narration:
      "Clients is the servicing home for active accounts. Filter personal and commercial clients, search by name, business, email, or managed by, then open the client dashboard. The dashboard brings policies, billing, claims, documents, remarks, marketing, loss runs, and open activities into one place so staff do not have to hunt across categories.",
  },
  {
    slug: "policies",
    route: "/employee/policies",
    detailRoute: "/employee/policies/policy_home",
    title: "Policies",
    narration:
      "Policies is organized by policy number, not just asset, because one policy can cover more than one item. Use the list to search and filter, then open a policy for the overview, coverage, holder list, documents, renewal workflow, and timeline. Send to client or holder actions should use the policy overview and selected documents so the outgoing message is complete.",
  },
  {
    slug: "claims",
    route: "/employee/claims",
    title: "Claims",
    narration:
      "Claims keeps loss activity visible without turning it into a payment or carrier system replacement. Open the claim to see carrier path, status, dates, notes, and next action. Previous Loss Runs gives staff a clean loss-history packet that can be downloaded or sent to clients, holders, and carriers when underwriting needs it.",
  },
  {
    slug: "billing",
    route: "/employee/billing",
    detailRoute: "/employee/billing/policy_home",
    title: "Billing",
    narration:
      "Billing is for carrier payment visibility, not payment collection. Each row represents a policy and shows how the client pays the carrier, the plan, next due date, payment path, and status. Open the row to review billing summary, payment plan, premium changes, billing history, and the send-to-client summary that explains how the policy is being paid.",
  },
  {
    slug: "renewals",
    route: "/employee/renewals",
    title: "Renewals",
    narration:
      "Renewals controls the transition from the current term to the next term. Use the queue to find upcoming renewals, ready-for-review documents, carrier updates, and items needing staff attention. Updating for renewal creates a review draft first, and publishing should happen only after the fields and documents are checked.",
  },
  {
    slug: "carrier-downloads",
    route: "/employee/carrier-downloads",
    title: "Carrier downloads",
    narration:
      "Carrier downloads is the review point for incoming carrier data. The system matches carrier updates to the right client and policy, compares dates, premiums, documents, and billing details, and lets staff approve or reject changes. Nothing should update a client-facing record until the carrier download is reviewed and accepted.",
  },
  {
    slug: "document-review",
    route: "/employee/documents",
    title: "Document review",
    narration:
      "Document review is the agency template library. Upload templates, label the line of business, search the library, and set whether a template is required or needs customer, agent, or dual e-signature. Settings stay locked by default so template rules do not change accidentally during ordinary document review.",
  },
  {
    slug: "ai-marketing",
    route: "/employee/marketing",
    title: "AI marketing",
    narration:
      "AI marketing is where staff create and manage agency campaigns. The draft campaign area should produce branded pamphlets with the agency logo and contact details, the audience filters should include AI sorting, and active campaigns should be easy to view, pause, resume, and delete. Auto-message setup should stay simple enough that managers know exactly who receives what and when.",
  },
  {
    slug: "carrier-recommendations",
    route: "/employee/carriers",
    title: "Carrier recommendations",
    narration:
      "Carrier recommendations helps staff understand market fit before sending or ranking quotes. Review carrier appetite, risk fit, line of business, and recommendation logic, then use the details to decide which markets deserve attention. This page supports judgment; it does not replace licensed review.",
  },
  {
    slug: "analytics",
    route: "/employee/analytics",
    title: "Analytics",
    narration:
      "Analytics is the performance and goal center. Managers can review staff metrics, leaderboard performance, company targets, and requested goals, while agents see their own production and company expectations. Goal requests should notify managers and attach to performance goals without becoming an activity center task.",
  },
  {
    slug: "accounting",
    route: "/employee/accounting",
    title: "Accounting",
    narration:
      "Accounting supports staff records and timesheets. Agents see their own accounting information and submit timestamped timesheets, while managers configure the schedule, choose which company members receive it, and review incoming submissions. Timesheet notifications should appear for the selected recipients on the due date.",
  },
  {
    slug: "hr",
    route: "/employee/hr",
    title: "HR",
    narration:
      "HR gives staff a controlled way to submit workplace issues and company suggestions. Agents can choose anonymous or named submissions, and managers receive the record with status, date, and follow-up context. The category should feel private, clean, and separate from normal client activity.",
  },
  {
    slug: "calendar",
    route: "/employee/calendar",
    title: "Calendar",
    narration:
      "Calendar is the time view of agency work. It starts in week mode and shows personal reminders, company reminders, activity due dates, accepted internal meetings, and manually created events. Use the agenda to mark complete or reschedule, and completed events should remain crossed out instead of disappearing.",
  },
  {
    slug: "archive",
    route: "/employee/archive",
    title: "Archive",
    narration:
      "Archive stores prospects and clients that no longer belong in active queues. Use search and filters to find an archived record, quick view the basics, and restore only when the account should return to active servicing. Archive should stay quiet and controlled so the active portal remains focused.",
  },
  {
    slug: "training",
    route: "/employee/training",
    title: "Training videos",
    narration:
      "Training videos teaches staff how to use the portal. Each category has its own walkthrough, videos can open in a new tab, completed lessons are tracked, and the portal assistant can link users to the exact training section that answers their question. This is where new staff learn how the system should be operated.",
  },
  {
    slug: "agency-settings",
    route: "/employee/settings",
    title: "Agency settings",
    narration:
      "Agency settings protects important configuration. Locked cards keep tier settings, user slots, carrier allowances, AI message limits, signatures, and agency options from being changed accidentally. Managers unlock only the card they need, make the change, then save and relock it.",
  },
];

function ensureDirs() {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(tempDir, { recursive: true });
}

function writeNarration(category) {
  const textPath = path.join(tempDir, `${category.slug}.txt`);
  const wavPath = path.join(tempDir, `${category.slug}.wav`);
  fs.writeFileSync(textPath, category.narration, "utf8");
  const command = [
    "Add-Type -AssemblyName System.Speech;",
    `$text = Get-Content -Raw ${JSON.stringify(textPath)};`,
    "$voice = New-Object System.Speech.Synthesis.SpeechSynthesizer;",
    "try { $found = $voice.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Name -eq 'Microsoft Zira Desktop' } | Select-Object -First 1; if ($found) { $voice.SelectVoice($found.VoiceInfo.Name); } } catch {}",
    "$voice.Rate = 1;",
    "$voice.Volume = 100;",
    `$voice.SetOutputToWaveFile(${JSON.stringify(wavPath)});`,
    "$voice.Speak($text);",
    "$voice.Dispose();",
  ].join(" ");
  execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], {
    stdio: "inherit",
  });
  return wavPath;
}

function wavDurationSeconds(wavPath) {
  const buffer = fs.readFileSync(wavPath);
  const byteRate = buffer.readUInt32LE(28);
  const dataIndex = buffer.indexOf(Buffer.from("data"));
  if (!byteRate || dataIndex < 0) return 18;
  const dataSize = buffer.readUInt32LE(dataIndex + 4);
  return dataSize / byteRate;
}

async function preparePage(page, route) {
  await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForLoadState("networkidle", { timeout: 4500 }).catch(() => {});
  await page.waitForTimeout(800);
  await page.addStyleTag({
    content: `
      * { scroll-behavior: auto !important; caret-color: transparent !important; }
      body { background: #f8f6f1 !important; }
      .fixed.bottom-0, [aria-label="Ask AI"] { display: none !important; }
      *, *::before, *::after { animation-duration: .001ms !important; transition-duration: .001ms !important; }
    `,
  }).catch(() => {});
}

async function scrollToPercent(page, percent) {
  await page.evaluate((value) => {
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    window.scrollTo({ top: Math.round(maxScroll * value), behavior: "auto" });
  }, percent);
}

async function tourPage(page, category, totalMs) {
  const routeTime = category.detailRoute ? Math.floor(totalMs * 0.54) : totalMs;
  const stops = [0, 0.22, 0.48, 0.76, 1];
  const stopWait = Math.max(1150, Math.floor(routeTime / stops.length) - 220);

  for (const [index, stop] of stops.entries()) {
    await scrollToPercent(page, stop);
    await page.mouse.move(index % 2 === 0 ? 230 : 940, index % 2 === 0 ? 190 : 350, { steps: 14 });
    await page.waitForTimeout(stopWait);
  }

  if (category.detailRoute) {
    await preparePage(page, category.detailRoute);
    const detailTime = Math.max(3000, totalMs - routeTime);
    const detailStops = [0, 0.26, 0.52, 0.8];
    const detailWait = Math.max(1200, Math.floor(detailTime / detailStops.length) - 150);
    for (const [index, stop] of detailStops.entries()) {
      await scrollToPercent(page, stop);
      await page.mouse.move(index % 2 === 0 ? 980 : 270, index % 2 === 0 ? 220 : 520, { steps: 14 });
      await page.waitForTimeout(detailWait);
    }
  } else {
    await scrollToPercent(page, 0);
    await page.waitForTimeout(Math.max(900, totalMs * 0.08));
  }
}

async function recordCategory(browser, category, durationMs) {
  const rawDir = path.join(tempDir, "raw");
  fs.mkdirSync(rawDir, { recursive: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    recordVideo: { dir: rawDir, size: { width: 1280, height: 720 } },
  });
  await context.addInitScript(() => {
    window.localStorage.setItem("quotex.auth.userId.v1", "user_manager_pc");
  });
  const page = await context.newPage();
  await preparePage(page, category.route);
  const video = page.video();
  await tourPage(page, category, durationMs);
  await context.close();
  return video.path();
}

async function muxNarrationInBrowser(browser, rawVideoPath, wavPath, outputPath) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  await page.setContent("<!doctype html><html><body style='margin:0;background:#050504'></body></html>");
  const rawVideoDataUrl = `data:video/webm;base64,${fs.readFileSync(rawVideoPath).toString("base64")}`;
  const audioDataUrl = `data:audio/wav;base64,${fs.readFileSync(wavPath).toString("base64")}`;
  const result = await page.evaluate(async ({ rawVideoDataUrl, audioDataUrl }) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    document.body.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas rendering unavailable.");

    const video = document.createElement("video");
    video.src = rawVideoDataUrl;
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    document.body.appendChild(video);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Video metadata timed out.")), 15000);
      video.onloadedmetadata = () => {
        clearTimeout(timeout);
        resolve();
      };
      video.onerror = () => {
        clearTimeout(timeout);
        reject(new Error("Video decode failed."));
      };
    });

    const audioContext = new AudioContext();
    const audioBuffer = await audioContext.decodeAudioData(await (await fetch(audioDataUrl)).arrayBuffer());
    const destination = audioContext.createMediaStreamDestination();
    const audioSource = audioContext.createBufferSource();
    audioSource.buffer = audioBuffer;
    audioSource.connect(destination);

    const stream = canvas.captureStream(25);
    for (const track of destination.stream.getAudioTracks()) stream.addTrack(track);
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
      ? "video/webm;codecs=vp8,opus"
      : "video/webm";
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 1500000,
      audioBitsPerSecond: 96000,
    });
    const chunks = [];
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
      chunks.push(event.data);
    };
    const done = new Promise((resolve) => {
      recorder.onstop = async () => {
        resolve({ mimeType, base64: await blobToBase64(new Blob(chunks, { type: mimeType })) });
      };
    });

    function draw() {
      ctx.fillStyle = "#050504";
      ctx.fillRect(0, 0, 1280, 720);
      ctx.drawImage(video, 0, 0, 1280, 720);
      if (!video.paused && !video.ended) requestAnimationFrame(draw);
    }

    recorder.start(500);
    await audioContext.resume();
    await video.play();
    audioSource.start();
    requestAnimationFrame(draw);
    const maxDuration = Math.min(
      Number.isFinite(video.duration) ? video.duration : audioBuffer.duration,
      audioBuffer.duration
    );
    await new Promise((resolve) => setTimeout(resolve, Math.ceil(maxDuration * 1000) + 350));
    video.pause();
    recorder.stop();
    const finished = await done;
    await audioContext.close();
    return { ...finished, duration: maxDuration };
  }, { rawVideoDataUrl, audioDataUrl });
  fs.writeFileSync(outputPath, Buffer.from(result.base64, "base64"));
  await page.close();
  return { mimeType: result.mimeType, duration: result.duration, size: fs.statSync(outputPath).size };
}

(async () => {
  ensureDirs();
  const browser = await chromium.launch({ headless: true, channel: "msedge" }).catch(() =>
    chromium.launch({ headless: true })
  );
  try {
    const requestedCategory = process.env.QUOTEX_CATEGORY;
    const selectedCategories = requestedCategory
      ? categories.filter((category) => category.slug === requestedCategory)
      : categories;
    if (requestedCategory && selectedCategories.length === 0) {
      throw new Error(`Unknown category slug: ${requestedCategory}`);
    }
    for (const category of selectedCategories) {
      const outputPath = path.join(outputDir, `${category.slug}.webm`);
      console.log(`Recording ${category.title}...`);
      const wavPath = writeNarration(category);
      const durationMs = Math.ceil(Math.max(15000, wavDurationSeconds(wavPath) * 1000 + 2200));
      const rawVideoPath = await recordCategory(browser, category, durationMs);
      await muxNarrationInBrowser(browser, rawVideoPath, wavPath, outputPath);
      const sizeMb = (fs.statSync(outputPath).size / 1024 / 1024).toFixed(2);
      console.log(`Wrote ${outputPath} (${sizeMb} MB)`);
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
