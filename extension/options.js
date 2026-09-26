const FIELD_IDS = [
  "name", "email", "phone", "linkedinUrl", "currentCity", "country", "role", "location",
  "titleMatch", "excludeTerms", "maxApplications", "maxScanned", "yearsExperience",
  "workAuthorized", "needsSponsorship", "salary", "noticePeriod", "websiteUrl"
];
const form = document.getElementById("setupForm");
const resumeInput = document.getElementById("resume");
const resumeStatus = document.getElementById("resumeStatus");
const message = document.getElementById("message");
let customAnswers = [];

chrome.storage.local.get("profile", ({ profile = {} }) => {
  FIELD_IDS.forEach(id => {
    if (profile[id] != null) document.getElementById(id).value = profile[id];
  });
  customAnswers = Array.isArray(profile.customAnswers) ? profile.customAnswers : [];
  if (profile.resumeName) resumeStatus.textContent = `Saved: ${profile.resumeName}`;
  renderAnswers();
});

document.getElementById("addAnswer").addEventListener("click", () => {
  const question = document.getElementById("answerQuestion").value.trim();
  const answer = document.getElementById("answerValue").value.trim();
  if (!question || !answer) return showMessage("Add both a question keyword and answer.", true);
  customAnswers.push({ question, answer });
  document.getElementById("answerQuestion").value = "";
  document.getElementById("answerValue").value = "";
  renderAnswers();
});

document.getElementById("answerList").addEventListener("click", event => {
  const button = event.target.closest("button[data-index]");
  if (!button) return;
  customAnswers.splice(Number(button.dataset.index), 1);
  renderAnswers();
});

form.addEventListener("submit", async event => {
  event.preventDefault();
  const stored = await chrome.storage.local.get("profile");
  const profile = { ...(stored.profile || {}), customAnswers };
  FIELD_IDS.forEach(id => { profile[id] = document.getElementById(id).value.trim(); });
  profile.maxApplications = String(clamp(profile.maxApplications, 1, 100, 25));
  profile.maxScanned = String(clamp(profile.maxScanned, 25, 1000, 500));
  const file = resumeInput.files[0];
  if (file) {
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) return showMessage("Choose a PDF resume.", true);
    if (file.size > 5 * 1024 * 1024) return showMessage("Choose a PDF smaller than 5 MB.", true);
    profile.resumeName = file.name;
    profile.resumeType = "application/pdf";
    profile.resumeData = await toDataUrl(file);
  }
  await chrome.storage.local.set({ profile });
  resumeStatus.textContent = profile.resumeName ? `Saved: ${profile.resumeName}` : "No resume saved";
  showMessage("Saved. SIFT is ready.");
});

function renderAnswers() {
  const root = document.getElementById("answerList");
  root.innerHTML = customAnswers.length ? customAnswers.map((item, index) =>
    `<div><p><b>${escapeHtml(item.question)}</b><span>${escapeHtml(item.answer)}</span></p><button type="button" data-index="${index}" aria-label="Remove answer">×</button></div>`
  ).join("") : '<p class="empty-answer">No custom answers yet.</p>';
}

function escapeHtml(value) {
  const node = document.createElement("div");
  node.textContent = value;
  return node.innerHTML;
}

function showMessage(value, error = false) {
  message.textContent = value;
  message.className = error ? "error" : "success";
  setTimeout(() => { message.textContent = ""; message.className = ""; }, 3500);
}

function clamp(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function toDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
