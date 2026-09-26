const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const pause = () => wait(700 + Math.random() * 700);
const text = element => (element?.innerText || element?.textContent || "").trim();
const visible = element => Boolean(element && element.getClientRects().length && getComputedStyle(element).visibility !== "hidden");
let running = false;
let cancelled = false;

chrome.runtime.onMessage.addListener(message => {
  if (message.type === "SIFT_RUN") start(message.runId);
  if (message.type === "SIFT_CANCEL") cancelled = true;
});

chrome.storage.local.get("status", ({ status }) => {
  if (status?.active) start(status.runId);
});

async function start(runId) {
  if (running) return;
  running = true;
  cancelled = false;
  try {
    const { status, profile } = await chrome.storage.local.get(["status", "profile"]);
    if (!status?.active || status.runId !== runId || !profile) return;
    const guard = guardReason();
    if (guard) return finish(status, guard, "blocked");
    if (isStandalonePage()) await processStandalone(profile, status);
    else await processSearch(profile, status);
  } catch (error) {
    const status = await currentStatus();
    if (status?.active) {
      record(status, "SIFT", `Page error: ${String(error?.message || error).slice(0, 100)}`, "error");
      await finish(status, "Stopped after an unexpected LinkedIn page error.", "error");
    }
  } finally {
    running = false;
  }
}

function guardReason() {
  const pageText = text(document.body).toLowerCase();
  if (/login|checkpoint|challenge|authwall/.test(location.pathname)) return "Stopped: sign in to LinkedIn, then start again.";
  if (/security verification|verify (that )?you are human|captcha/.test(pageText)) return "Paused: complete LinkedIn's security check yourself, then start a new run.";
  return "";
}

function isStandalonePage() {
  return location.pathname.includes("/jobs/view/") && !document.querySelector(".jobs-search-results-list, .scaffold-layout__list, [class*='jobs-search-results-list']");
}

async function processSearch(profile, status) {
  status.phase = "searching";
  status.message = `Loading result batch ${status.batch || 1}…`;
  await update(status);
  const ready = await waitFor(() => collectCards().length, 30000);
  if (!ready) return advanceBatchOrFinish(status, false);

  const stored = await chrome.storage.local.get("submittedJobIds");
  const submitted = new Set(stored.submittedJobIds || []);
  const seen = new Set(status.seenJobIds || []);
  let processedThisBatch = 0;
  let quietRounds = 0;

  for (let round = 0; round < 90; round += 1) {
    status = await activeStatus(status.runId);
    if (!status) return;
    if (limitReached(status)) return finishForLimit(status);
    const guard = guardReason();
    if (guard) return finish(status, guard, "blocked");

    const candidates = collectCards().filter(card => {
      const id = cardId(card);
      return id && !seen.has(id);
    });
    if (candidates.length) quietRounds = 0;
    else quietRounds += 1;

    for (const card of candidates) {
      status = await activeStatus(status.runId);
      if (!status || limitReached(status)) break;
      const id = cardId(card);
      const cardTitle = titleFromCard(card) || profile.role;
      const cardLocation = locationFromCard(card);
      seen.add(id);
      processedThisBatch += 1;
      status.scanned = (status.scanned || 0) + 1;
      status.seenJobIds = [...seen].slice(-2000);
      status.message = `Scanning ${status.scanned} · ${cardTitle}`;
      await update(status);

      if (!titleMatches(cardTitle, profile) || !locationMatches(cardLocation, profile.location)) continue;
      if (/\bapplied\b/i.test(text(card)) || submitted.has(id)) {
        status.skipped += 1;
        record(status, cardTitle, "Already applied", "skip");
        await update(status);
        continue;
      }

      const outcome = await processCard(card, id, cardTitle, profile, status);
      if (outcome.navigated) return;
      status = (await currentStatus()) || status;
      if (!status.active) return;
      if (outcome.blocked) {
        record(status, outcome.title || cardTitle, outcome.reason, "error");
        return finish(status, `Paused: ${outcome.reason}`, "blocked");
      }
      if (outcome.ok) {
        status.applied += 1;
        record(status, outcome.title || cardTitle, "Application submitted", "success");
        submitted.add(id);
        await chrome.storage.local.set({ submittedJobIds: [...submitted].slice(-5000) });
      } else {
        status.skipped += 1;
        record(status, outcome.title || cardTitle, outcome.reason, outcome.kind || "skip");
      }
      await update(status);
      if (limitReached(status)) return finishForLimit(status);
      await pause();
    }

    const scroller = resultScroller();
    const before = scroller.scrollTop;
    const amount = Math.max(Math.floor(scroller.clientHeight * .82), 540);
    scroller.scrollTo({ top: before + amount, behavior: "smooth" });
    scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    await wait(1100);
    if (Math.abs(scroller.scrollTop - before) < 8) quietRounds += 1;
    if (quietRounds >= 4) break;
  }

  status = await activeStatus(status.runId);
  if (status) await advanceBatchOrFinish(status, processedThisBatch > 0);
}

async function processCard(card, id, fallbackTitle, profile, status) {
  const link = card.querySelector('a[href*="/jobs/view/"]') || (card.matches?.('a[href*="/jobs/view/"]') ? card : null);
  if (!link) return { ok: false, reason: "Job link was unavailable" };
  const beforeUrl = location.href;
  const beforeTitle = detailTitle();
  status.phase = "opening_job";
  status.message = `Opening ${fallbackTitle}…`;
  await update(status);
  card.scrollIntoView({ block: "center" });
  link.dispatchEvent(new MouseEvent("click", { view: window, bubbles: true, cancelable: true, button: 0 }));
  await pause();
  const detailReady = await waitFor(() => {
    const currentId = new URL(location.href).searchParams.get("currentJobId") || location.pathname.match(/\/jobs\/view\/(\d+)/)?.[1];
    const currentTitle = detailTitle();
    return currentId === id || location.href !== beforeUrl || (currentTitle && currentTitle !== beforeTitle);
  }, 15000);
  if (!detailReady) return { ok: false, reason: "Job details did not load" };
  await wait(550);
  if (isStandalonePage()) return { navigated: true };

  const title = detailTitle() || fallbackTitle;
  const place = detailLocation();
  if (!titleMatches(title, profile) || !locationMatches(place, profile.location)) {
    return { ok: false, title, reason: "Title or location did not match" };
  }
  if (alreadyApplied()) return { ok: false, title, reason: "Already applied" };
  const easyApply = await waitFor(findEasyApply, 8000);
  if (!easyApply) return { ok: false, title, reason: "Company does not offer Easy Apply" };

  status.phase = "applying";
  status.message = `Completing Easy Apply · ${title}`;
  await update(status);
  easyApply.click();
  await pause();
  const result = await completeApplication(profile);
  if (!result.ok) await closeApplication();
  return { ...result, title };
}

async function processStandalone(profile, status) {
  status.phase = "opening_job";
  status.message = "Checking opened job…";
  await update(status);
  await waitFor(() => detailTitle(), 20000);
  const id = location.pathname.match(/\/jobs\/view\/(\d+)/)?.[1] || location.href;
  const title = detailTitle() || profile.role;
  const place = detailLocation();
  const seen = new Set(status.seenJobIds || []);
  const isNew = !seen.has(id);
  seen.add(id);
  status.seenJobIds = [...seen].slice(-2000);
  if (isNew) status.scanned = (status.scanned || 0) + 1;

  const stored = await chrome.storage.local.get("submittedJobIds");
  const submitted = new Set(stored.submittedJobIds || []);
  let result;
  if (!titleMatches(title, profile) || !locationMatches(place, profile.location)) {
    result = { ok: false, reason: "Title or location did not match" };
  } else if (alreadyApplied() || submitted.has(id)) {
    result = { ok: false, reason: "Already applied" };
  } else {
    const easyApply = await waitFor(findEasyApply, 10000);
    if (!easyApply) result = { ok: false, reason: "Company does not offer Easy Apply" };
    else {
      status.phase = "applying";
      status.message = `Completing Easy Apply · ${title}`;
      await update(status);
      easyApply.click();
      await pause();
      result = await completeApplication(profile);
      if (!result.ok) await closeApplication();
    }
  }

  status = (await currentStatus()) || status;
  if (!status.active) return;
  if (result.blocked) {
    record(status, title, result.reason, "error");
    return finish(status, `Paused: ${result.reason}`, "blocked");
  }
  if (result.ok) {
    status.applied += 1;
    record(status, title, "Application submitted", "success");
    submitted.add(id);
    await chrome.storage.local.set({ submittedJobIds: [...submitted].slice(-5000) });
  } else {
    status.skipped += 1;
    record(status, title, result.reason, result.kind || "skip");
  }
  await update(status);
  if (limitReached(status)) return finishForLimit(status);
  status.phase = "searching";
  status.message = "Returning to results for the next job…";
  await update(status);
  location.assign(batchUrl(status));
}

async function advanceBatchOrFinish(status, hadResults) {
  status.emptyBatches = hadResults ? 0 : (status.emptyBatches || 0) + 1;
  const exhausted = status.emptyBatches >= 3 || (status.scanned || 0) >= Number(status.maxScanned || 500);
  if (exhausted) {
    return finish(status, `Run complete: ${status.applied} submitted, ${status.skipped} skipped, ${status.scanned} scanned.`, "complete");
  }
  status.nextStart = (status.nextStart || 0) + 25;
  status.batch = (status.batch || 1) + 1;
  status.phase = "searching";
  status.message = `Loading result batch ${status.batch}…`;
  await update(status);
  location.assign(batchUrl(status));
}

function batchUrl(status) {
  const url = new URL(status.searchUrl || "https://www.linkedin.com/jobs/search/");
  if ((status.nextStart || 0) > 0) url.searchParams.set("start", String(status.nextStart));
  return url.href;
}

function collectCards() {
  const root = resultsRoot();
  const links = [...root.querySelectorAll('a[href*="/jobs/view/"]')];
  return [...new Set(links.map(link => link.closest("li, .jobs-search-results__list-item, .job-card-container, [data-job-id], [data-occludable-job-id]") || link))]
    .filter(visible);
}

function resultsRoot() {
  return document.querySelector(".jobs-search-results-list, .scaffold-layout__list, [class*='jobs-search-results-list']") || document;
}

function resultScroller() {
  const root = resultsRoot();
  if (root !== document && root.scrollHeight > root.clientHeight + 20) return root;
  const candidates = [...document.querySelectorAll(".jobs-search-results-list, .scaffold-layout__list, [class*='jobs-search-results'], [class*='scaffold-layout__list']")];
  return candidates.filter(node => node.scrollHeight > node.clientHeight + 20)
    .sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))[0] || document.scrollingElement;
}

function cardId(card) {
  const direct = card.getAttribute?.("data-job-id") || card.getAttribute?.("data-occludable-job-id");
  if (direct) return String(direct);
  const href = (card.matches?.('a[href*="/jobs/view/"]') ? card : card.querySelector?.('a[href*="/jobs/view/"]'))?.href;
  return href?.match(/\/jobs\/view\/(\d+)/)?.[1] || "";
}

function titleFromCard(card) {
  const selectors = [
    ".job-card-list__title--link", ".job-card-container__link", "[class*='job-card-list__title']",
    "a[href*='/jobs/view/'] strong", "a[href*='/jobs/view/'] span[aria-hidden='true']"
  ];
  for (const selector of selectors) {
    const value = text(card.querySelector(selector));
    if (value) return value.split("\n")[0].trim();
  }
  return text(card).split("\n").find(Boolean) || "";
}

function locationFromCard(card) {
  const selectors = [
    ".job-card-container__metadata-item", ".artdeco-entity-lockup__caption", "[class*='job-card-container__metadata']"
  ];
  return [...selectors.map(selector => text(card.querySelector(selector))), text(card)].filter(Boolean).join(" · ");
}

function detailTitle() {
  const selectors = [
    ".job-details-jobs-unified-top-card__job-title", ".jobs-unified-top-card__job-title",
    ".job-details-jobs-unified-top-card__job-title-link", "h1"
  ];
  return selectors.map(selector => text(document.querySelector(selector))).find(Boolean) || "";
}

function detailLocation() {
  const selectors = [
    ".job-details-jobs-unified-top-card__primary-description-container",
    ".jobs-unified-top-card__bullet", ".job-details-jobs-unified-top-card__tertiary-description-container"
  ];
  return selectors.map(selector => text(document.querySelector(selector))).find(Boolean) || "";
}

function normalize(value) {
  return String(value || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
}

function titleMatches(title, profile) {
  const actual = normalize(title);
  const wanted = normalize(profile.role);
  if (!actual || !wanted) return false;
  const excluded = String(profile.excludeTerms || "").split(",").map(normalize).filter(Boolean);
  if (excluded.some(term => actual.includes(term))) return false;
  return profile.titleMatch === "exact" ? actual === wanted : (` ${actual} `).includes(` ${wanted} `);
}

function locationMatches(actualLocation, requestedLocation) {
  const wanted = normalize(requestedLocation);
  if (!wanted || /^(worldwide|global|anywhere|any|all locations)$/.test(wanted)) return true;
  const actual = normalize(actualLocation);
  if (!actual) return false;
  if (wanted === "remote") return actual.includes("remote");
  if (/remote.*(worldwide|global|anywhere)|(worldwide|global|anywhere).*remote/.test(wanted)) return actual.includes("remote");
  const aliases = { bengaluru: "bangalore", bangalore: "bengaluru", gurugram: "gurgaon", gurgaon: "gurugram" };
  return actual.includes(wanted) || Boolean(aliases[wanted] && actual.includes(aliases[wanted]));
}

function detailRoot() {
  return document.querySelector(".jobs-search__job-details--container, .scaffold-layout__detail, .jobs-details, [class*='job-details']") || document;
}

function findEasyApply() {
  return [...detailRoot().querySelectorAll("button")].find(button => visible(button) && /\beasy apply\b/i.test(`${text(button)} ${button.getAttribute("aria-label") || ""}`)) || null;
}

function alreadyApplied() {
  return [...detailRoot().querySelectorAll("button, span")].some(element => visible(element) && /^applied(?:\s|$)/i.test(text(element)));
}

async function completeApplication(profile) {
  for (let step = 0; step < 18; step += 1) {
    if (cancelled) return { ok: false, reason: "Stopped by you" };
    await pause();
    const modal = applicationModal();
    if (!modal) return { ok: false, reason: "Application dialog closed before confirmation", kind: "error" };
    const modalText = text(modal);
    if (/captcha|security verification|verify (that )?you are human/i.test(modalText)) {
      return { ok: false, blocked: true, reason: "LinkedIn security check requires you", kind: "error" };
    }
    await attachResume(modal, profile);
    const answerResult = fillKnownFields(modal, profile);
    if (!answerResult.ok) return answerResult;
    await wait(300);

    const validationError = [...modal.querySelectorAll(".artdeco-inline-feedback--error, [role='alert']")]
      .map(text).find(value => value && !/optional/i.test(value));
    if (validationError) return { ok: false, reason: validationError.slice(0, 110) };

    const submit = findButton(/^submit application$/i, modal);
    if (submit && !submit.disabled) {
      submit.click();
      return await confirmSubmission();
    }
    const advance = findButton(/^review( application)?$/i, modal) || findButton(/^(next|continue)$/i, modal);
    if (!advance || advance.disabled) return { ok: false, reason: "Required question needs a saved answer" };
    const before = formSignature(modal);
    advance.click();
    await waitFor(() => !applicationModal() || formSignature(applicationModal()) !== before, 10000);
  }
  return { ok: false, reason: "Application has too many form steps" };
}

function fillKnownFields(root, profile) {
  const groups = [...root.querySelectorAll("fieldset, .fb-dash-form-element")];
  for (const group of groups) {
    const question = questionText(group);
    const radios = [...group.querySelectorAll('input[type="radio"]')];
    if (radios.length) {
      const answer = answerFor(question, profile);
      if (!answer) {
        if (isRequired(group, radios[0])) return { ok: false, reason: `Missing saved answer: ${shortQuestion(question)}` };
        continue;
      }
      const choice = radios.find(radio => optionMatches(text(radio.closest("label") || radio.parentElement), answer));
      if (!choice) return { ok: false, reason: `Saved answer not offered: ${shortQuestion(question)}` };
      if (!choice.checked) choice.click();
    }
  }

  const controls = [...root.querySelectorAll("input:not([type=file]):not([type=hidden]):not([type=radio]), select, textarea")].filter(visible);
  for (const control of controls) {
    if (control.disabled || control.readOnly) continue;
    const wrap = control.closest(".jobs-easy-apply-form-section__grouping, .fb-dash-form-element, label, fieldset") || control.parentElement;
    const question = questionText(wrap);
    if (control.type === "checkbox") {
      if (control.checked) continue;
      const answer = answerFor(question, profile);
      if (/^(yes|true|agree|checked)$/i.test(answer)) control.click();
      else if (isRequired(wrap, control)) return { ok: false, reason: `Required checkbox: ${shortQuestion(question)}` };
      continue;
    }
    const answered = control.tagName === "SELECT" ? control.selectedIndex > 0 : String(control.value || "").trim() !== "";
    if (answered) continue;
    const answer = answerFor(question, profile);
    if (answer) {
      if (control.tagName === "SELECT") {
        const choice = [...control.options].find(option => optionMatches(text(option), answer));
        if (!choice) return { ok: false, reason: `Saved answer not offered: ${shortQuestion(question)}` };
        setControlValue(control, choice.value);
      } else {
        setControlValue(control, answer);
      }
      continue;
    }
    if (isRequired(wrap, control)) return { ok: false, reason: `Missing saved answer: ${shortQuestion(question)}` };
  }
  return { ok: true };
}

function answerFor(question, profile) {
  const value = normalize(question);
  const custom = (profile.customAnswers || []).find(rule => value.includes(normalize(rule.question)));
  if (custom) return String(custom.answer || "").trim();
  if (/phone|mobile/.test(value)) return profile.phone || "";
  if (/email/.test(value)) return profile.email || "";
  if (/linkedin/.test(value)) return profile.linkedinUrl || "";
  if (/portfolio|website|personal site/.test(value)) return profile.websiteUrl || "";
  if (/current city|city.*reside|location/.test(value)) return profile.currentCity || profile.location || "";
  if (/country/.test(value)) return profile.country || "";
  if (/years.*experience|experience.*years/.test(value)) return profile.yearsExperience || "";
  if (/salary|compensation|pay expectation/.test(value)) return profile.salary || "";
  if (/notice period|available to start|start date/.test(value)) return profile.noticePeriod || "";
  if (/authorized|legally.*work|right to work/.test(value)) return profile.workAuthorized || "";
  if (/sponsor|visa sponsorship/.test(value)) return profile.needsSponsorship || "";
  return "";
}

function questionText(element) {
  const label = element?.querySelector?.("legend, label, .fb-dash-form-element__label, [class*='form-element__label']");
  return text(label) || text(element).split("\n").slice(0, 2).join(" ");
}

function shortQuestion(value) {
  return String(value || "required field").replace(/\s+/g, " ").slice(0, 90);
}

function optionMatches(option, wanted) {
  const left = normalize(option);
  const right = normalize(wanted);
  return left === right || left.startsWith(`${right} `) || (` ${left} `).includes(` ${right} `);
}

function isRequired(wrapper, control) {
  return Boolean(control?.required || control?.getAttribute("aria-required") === "true" || wrapper?.querySelector?.(".required, [aria-required='true']"));
}

function setControlValue(control, value) {
  const proto = control.tagName === "SELECT" ? HTMLSelectElement.prototype : control.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(control, value); else control.value = value;
  control.dispatchEvent(new Event("input", { bubbles: true }));
  control.dispatchEvent(new Event("change", { bubbles: true }));
  control.dispatchEvent(new Event("blur", { bubbles: true }));
}

async function attachResume(root, profile) {
  const input = root.querySelector('input[type="file"]');
  if (!input || input.files?.length) return;
  const encoded = String(profile.resumeData || "").split(",").pop();
  if (!encoded) return;
  const raw = atob(encoded);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  const file = new File([bytes], profile.resumeName || "resume.pdf", { type: "application/pdf" });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await wait(900);
}

async function confirmSubmission() {
  const successPattern = /application (was )?(sent|submitted)|your application was sent|thank you for applying|you applied/i;
  const confirmed = await waitFor(() => {
    const modal = applicationModal();
    if (modal && successPattern.test(text(modal))) return true;
    if (successPattern.test(text(document.querySelector("[role='alert'], .artdeco-toast-item, .jobs-easy-apply-content")))) return true;
    if (alreadyApplied()) return true;
    return false;
  }, 15000);
  if (!confirmed) return { ok: false, reason: "Submission was not confirmed", kind: "error" };
  const modal = applicationModal();
  if (modal) {
    const done = findButton(/^(done|close|dismiss)$/i, modal) || modal.querySelector("button[aria-label*='Dismiss'], button[aria-label*='Close']");
    done?.click();
    await waitFor(() => !applicationModal(), 6000);
  }
  return { ok: true };
}

async function closeApplication() {
  const modal = applicationModal();
  if (!modal) return;
  const close = findButton(/^(dismiss|close|cancel)$/i, modal) || modal.querySelector("button[aria-label*='Dismiss'], button[aria-label*='Close']");
  close?.click();
  await wait(400);
  const discard = findButton(/^(discard|dismiss)$/i);
  discard?.click();
  await wait(400);
}

function applicationModal() {
  return [...document.querySelectorAll("[role='dialog'], .jobs-easy-apply-modal")].find(visible) || null;
}

function findButton(pattern, root = document) {
  return [...root.querySelectorAll("button")].find(button => visible(button) && (pattern.test(text(button)) || pattern.test(button.getAttribute("aria-label") || ""))) || null;
}

function formSignature(modal) {
  if (!modal) return "closed";
  return `${text(modal).slice(0, 500)}|${[...modal.querySelectorAll("input, select, textarea")].length}`;
}

function record(status, job, reason, kind = "skip") {
  status.events = [{ job: job || "Job", reason, kind, at: Date.now() }, ...(status.events || [])].slice(0, 20);
}

function limitReached(status) {
  return (status.applied || 0) >= Number(status.maxApplications || 25) || (status.scanned || 0) >= Number(status.maxScanned || 500);
}

async function finishForLimit(status) {
  const applicationLimit = (status.applied || 0) >= Number(status.maxApplications || 25);
  const message = applicationLimit
    ? `Run complete: reached your limit of ${status.maxApplications} submitted applications.`
    : `Run complete: reached your scan limit of ${status.maxScanned} jobs.`;
  return finish(status, message, "complete");
}

async function activeStatus(runId) {
  if (cancelled) return null;
  const status = await currentStatus();
  return status?.active && status.runId === runId ? status : null;
}

async function currentStatus() {
  return (await chrome.storage.local.get("status")).status;
}

async function update(status) {
  status.lastHeartbeat = Date.now();
  status.seenJobIds = (status.seenJobIds || []).slice(-2000);
  await chrome.runtime.sendMessage({ type: "SIFT_UPDATE_STATUS", status });
}

async function finish(status, message, phase) {
  status.active = false;
  status.phase = phase;
  status.message = message;
  await update(status);
}

async function waitFor(test, timeout) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (cancelled) return null;
    const result = test();
    if (result) return result;
    await wait(350);
  }
  return null;
}
