const $ = id => document.getElementById(id);
const roleEl = $("quickRole");
const locationEl = $("quickLocation");
const limitEl = $("quickLimit");
let initialized = false;

const ROLES = [
  "Data Analyst", "Senior Data Analyst", "Junior Data Analyst", "Business Data Analyst",
  "Business Intelligence Analyst", "BI Analyst", "Product Analyst", "Reporting Analyst",
  "Data Quality Analyst", "Marketing Data Analyst", "Operations Analyst", "Analytics Consultant",
  "Data Scientist", "Machine Learning Engineer", "Software Engineer", "Frontend Developer",
  "Backend Developer", "Product Manager", "UX Designer", "Financial Analyst"
];

function installRecommendations() {
  $("roleList").innerHTML = ROLES.map(option).join("");
  const codes = "AD AE AF AG AI AL AM AO AR AS AT AU AZ BA BB BD BE BF BG BH BI BJ BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CL CM CN CO CR CU CV CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FM FR GA GB GD GE GH GM GN GQ GR GT GW GY HK HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP KE KG KH KM KN KP KR KW KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MH MK ML MM MN MR MT MU MV MW MX MY MZ NA NE NG NI NL NO NP NZ OM PA PE PG PH PK PL PT PY QA RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SY SZ TD TG TH TJ TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VN YE ZA ZM ZW".split(" ");
  const names = new Intl.DisplayNames(["en"], { type: "region" });
  const hubs = [
    "Remote — Worldwide", "Bengaluru", "Hyderabad", "Mumbai", "Delhi NCR", "Pune", "Chennai",
    "Gurugram", "Noida", "New York City", "San Francisco Bay Area", "Los Angeles", "Seattle",
    "Austin", "Boston", "Chicago", "Toronto", "Vancouver", "Mexico City", "São Paulo", "London",
    "Dublin", "Amsterdam", "Berlin", "Paris", "Madrid", "Lisbon", "Zurich", "Singapore", "Tokyo",
    "Seoul", "Hong Kong", "Dubai", "Abu Dhabi", "Sydney", "Melbourne", "Auckland", "Cape Town"
  ];
  const values = ["Worldwide", "Remote", ...codes.map(code => names.of(code)).filter(Boolean), ...hubs];
  $("locationList").innerHTML = [...new Set(values)].map(option).join("");
}

function option(value) {
  const el = document.createElement("option");
  el.value = value;
  return el.outerHTML;
}

function refresh() {
  chrome.runtime.sendMessage({ type: "SIFT_STATUS" }, response => {
    const status = response?.status || {};
    const profile = response?.profile || {};
    if (!initialized) {
      roleEl.value = profile.role || "Data Analyst";
      locationEl.value = profile.location || "Worldwide";
      limitEl.value = profile.maxApplications || 25;
      initialized = true;
    }
    $("status").textContent = status.message || "Ready when you are";
    $("phase").textContent = String(status.phase || "ready").toUpperCase();
    $("phase").className = "phase " + (status.active ? "live" : "");
    $("scanned").textContent = status.scanned || 0;
    $("applied").textContent = status.applied || 0;
    $("skipped").textContent = status.skipped || 0;
    const limit = Number(status.maxApplications || limitEl.value || 25);
    $("progressBar").style.width = Math.min(100, ((status.applied || 0) / limit) * 100) + "%";
    $("events").innerHTML = (status.events || []).map(event =>
      `<div><i class="${event.kind || "skip"}"></i><p><b>${escapeHtml(event.job || "Job")}</b><span>${escapeHtml(event.reason || "")}</span></p></div>`
    ).join("") || '<div class="empty-log">Submitted and skipped jobs appear here.</div>';
    $("start").disabled = Boolean(status.active);
    $("stop").disabled = !status.active;
    $("clear").disabled = Boolean(status.active);
  });
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value || "");
  return div.innerHTML;
}

$("start").addEventListener("click", async () => {
  const stored = await chrome.storage.local.get("profile");
  const profile = {
    ...(stored.profile || {}),
    role: roleEl.value.trim(),
    location: locationEl.value.trim() || "Worldwide",
    maxApplications: String(Math.max(1, Math.min(100, Number(limitEl.value) || 25)))
  };
  await chrome.storage.local.set({ profile });
  chrome.runtime.sendMessage({ type: "SIFT_START" }, response => {
    if (!response?.ok) $("status").textContent = response?.error || "Could not start SIFT.";
    refresh();
  });
});

$("stop").addEventListener("click", () => chrome.runtime.sendMessage({ type: "SIFT_STOP" }, refresh));
$("setup").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("clear").addEventListener("click", () => chrome.runtime.sendMessage({ type: "SIFT_CLEAR_HISTORY" }, refresh));

installRecommendations();
refresh();
setInterval(refresh, 1000);
