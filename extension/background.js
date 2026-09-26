const DEFAULT_STATUS = {
  active: false,
  phase: "idle",
  scanned: 0,
  applied: 0,
  skipped: 0,
  message: "Ready when you are",
  events: []
};

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  const stored = await chrome.storage.local.get(["status", "profile"]);
  const profile = {
    maxApplications: "25",
    maxScanned: "500",
    titleMatch: "contains",
    location: "Worldwide",
    customAnswers: [],
    ...(stored.profile || {})
  };
  if (reason === "install" || !stored.status) {
    await chrome.storage.local.set({ status: DEFAULT_STATUS, profile });
  } else {
    await chrome.storage.local.set({ profile });
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  const rawUrl = changeInfo.url || tab.url || "";
  let page;
  try { page = new URL(rawUrl); } catch { return; }
  if (page.protocol !== "https:" || !/(^|\.)linkedin\.com$/.test(page.hostname) || !page.pathname.startsWith("/jobs/")) return;
  const { status } = await chrome.storage.local.get("status");
  if (!status?.active || status.tabId !== tabId) return;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: "SIFT_RUN", runId: status.runId });
      return;
    } catch {
      await delay(750);
    }
  }
  await finishRun(status, "Stopped: SIFT could not reconnect to the LinkedIn tab.", "error");
});

chrome.alarms.onAlarm.addListener(async ({ name }) => {
  if (name !== "sift-watchdog") return;
  const { status } = await chrome.storage.local.get("status");
  if (status?.active && Date.now() - (status.lastHeartbeat || status.startedAt || 0) > 120000) {
    await finishRun(status, "Stopped: LinkedIn did not respond for two minutes.", "error");
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SIFT_START") {
    startRun(message.brief).then(sendResponse);
    return true;
  }
  if (message.type === "SIFT_STOP") {
    stopRun().then(sendResponse);
    return true;
  }
  if (message.type === "SIFT_STATUS") {
    chrome.storage.local.get(["status", "profile"], result => sendResponse({ ok: true, ...result }));
    return true;
  }
  if (message.type === "SIFT_CLEAR_HISTORY") {
    chrome.storage.local.set({ submittedJobIds: [], status: DEFAULT_STATUS }).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message.type === "SIFT_UPDATE_STATUS") {
    updateFromLinkedIn(message.status, sender).then(sendResponse);
    return true;
  }
});

async function updateFromLinkedIn(nextStatus, sender) {
  const { status } = await chrome.storage.local.get("status");
  let page;
  try { page = new URL(sender.url || ""); } catch { return { ok: false }; }
  if (!/(^|\.)linkedin\.com$/.test(page.hostname)) return { ok: false };
  if (!status || status.runId !== nextStatus?.runId || status.tabId !== sender.tab?.id) return { ok: false };
  await chrome.storage.local.set({ status: nextStatus });
  if (!nextStatus.active) await chrome.alarms.clear("sift-watchdog");
  return { ok: true };
}

async function startRun(brief = {}) {
  const stored = await chrome.storage.local.get(["profile", "status"]);
  const profile = { ...(stored.profile || {}), ...brief };
  profile.role = String(profile.role || "").trim();
  profile.location = String(profile.location || "Worldwide").trim() || "Worldwide";
  profile.maxApplications = clamp(profile.maxApplications, 1, 100, 25);
  profile.maxScanned = clamp(profile.maxScanned, 25, 1000, 500);
  if (!profile.resumeData) return { ok: false, error: "Add a PDF resume in Setup before starting." };
  if (!profile.role) return { ok: false, error: "Enter a target role before starting." };
  if (stored.status?.active) return { ok: false, error: "A SIFT run is already active." };

  const searchUrl = buildSearchUrl(profile.role, profile.location);
  const tab = await chrome.tabs.create({ url: "about:blank", active: true });
  const runId = crypto.randomUUID();
  const status = {
    ...DEFAULT_STATUS,
    active: true,
    phase: "opening",
    message: "Opening LinkedIn Easy Apply search…",
    runId,
    tabId: tab.id,
    searchUrl,
    nextStart: 0,
    batch: 1,
    emptyBatches: 0,
    seenJobIds: [],
    maxApplications: profile.maxApplications,
    maxScanned: profile.maxScanned,
    startedAt: Date.now(),
    lastHeartbeat: Date.now()
  };
  await chrome.storage.local.set({ profile, status });
  chrome.alarms.create("sift-watchdog", { periodInMinutes: 1 });
  await chrome.tabs.update(tab.id, { url: searchUrl });
  return { ok: true, runId };
}

async function stopRun() {
  const { status } = await chrome.storage.local.get("status");
  if (status?.tabId) {
    try { await chrome.tabs.sendMessage(status.tabId, { type: "SIFT_CANCEL", runId: status.runId }); } catch {}
  }
  await finishRun(status || DEFAULT_STATUS, "Stopped by you", "stopped");
  return { ok: true };
}

async function finishRun(status, message, phase) {
  await chrome.alarms.clear("sift-watchdog");
  await chrome.storage.local.set({
    status: { ...DEFAULT_STATUS, ...status, active: false, phase, message, lastHeartbeat: Date.now() }
  });
}

function buildSearchUrl(role, location) {
  const url = new URL("https://www.linkedin.com/jobs/search/");
  url.searchParams.set("keywords", role);
  url.searchParams.set("f_AL", "true");
  url.searchParams.set("f_TPR", "r604800");
  url.searchParams.set("sortBy", "DD");
  const remoteWorldwide = /remote.*(worldwide|global|anywhere)|(worldwide|global|anywhere).*remote/i.test(location);
  const worldwide = /^(worldwide|global|anywhere|any|all locations)$/i.test(location);
  if (worldwide || remoteWorldwide) url.searchParams.set("geoId", "92000000");
  else url.searchParams.set("location", location);
  if (remoteWorldwide || /^remote$/i.test(location)) url.searchParams.set("f_WT", "2");
  return url.href;
}

function clamp(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
