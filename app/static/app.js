import { channelColors, channelLabels, channelRgb } from "./js/constants.js";
import { createChartController } from "./js/chart-controller.js";
import { api, withButtonFeedback } from "./js/http.js";
import { createModal } from "./js/modal.js";

let currentState = null;
let chartController = null;

const stateView = document.getElementById("state-view");
const validationBanner = document.getElementById("validation-banner");
const validationText = document.getElementById("validation-text");
const sliders = document.getElementById("sliders");
const programBody = document.querySelector("#program-table tbody");
const programChart = document.getElementById("program-chart");
const chartLegend = document.getElementById("chart-legend");
const manualPanel = document.getElementById("manual-panel");
const autoPanel = document.getElementById("auto-panel");
const chartWrap = document.querySelector(".chart-wrap");
const autoViewChartBtn = document.getElementById("auto-view-chart");
const autoViewJsonBtn = document.getElementById("auto-view-json");
const resetChartViewBtn = document.getElementById("reset-chart-view");
const manualUnsaved = document.getElementById("manual-unsaved");
const autoUnsaved = document.getElementById("auto-unsaved");
const applyProgramBtn = document.getElementById("apply-program");
const manualSnap5Pct = document.getElementById("manual-snap-5pct");
const autoSnap5Pct = document.getElementById("auto-snap-5pct");
const snap15m = document.getElementById("snap-15m");
const pollingEnabled = document.getElementById("polling-enabled");
const pollingIntervalMinutes = document.getElementById("polling-interval-minutes");
const savePollingConfigBtn = document.getElementById("save-polling-config");
const uiModal = document.getElementById("ui-modal");
const uiModalTitle = document.getElementById("ui-modal-title");
const uiModalText = document.getElementById("ui-modal-text");
const uiModalInput = document.getElementById("ui-modal-input");
const uiModalCancel = document.getElementById("ui-modal-cancel");
const uiModalOk = document.getElementById("ui-modal-ok");
let autoViewMode = "chart";

function getProgramRowsData() {
  return [...programBody.querySelectorAll("tr")].map((row, idx) => {
    const [hour, minute] = (row.querySelector(".tm")?.value || "00:00").split(":").map(Number);
    return {
      row,
      rowIndex: idx,
      hour: Number(hour) || 0,
      minute: Number(minute) || 0,
      ch1: Number(row.querySelector(".ch1")?.value) || 0,
      ch2: Number(row.querySelector(".ch2")?.value) || 0,
      ch3: Number(row.querySelector(".ch3")?.value) || 0,
      ch4: Number(row.querySelector(".ch4")?.value) || 0,
      minuteOfDay: (Number(hour) || 0) * 60 + (Number(minute) || 0),
    };
  });
}

function removeProgramRow(row) {
  if (!row) return;
  destroyRowTimepicker(row);
  row.remove();
  if (chartController) chartController.onRowRemoved(row);
  normalizeProgramRows();
  drawProgramChart(collectProgram(false).points);
  updateUnsavedIndicators();
}

function renderJSON(el, value) {
  el.textContent = JSON.stringify(value, null, 2);
}

function timeSince(isoTime) {
  if (!isoTime) return "";
  const dt = new Date(isoTime);
  if (Number.isNaN(dt.getTime())) return "";
  const diffMs = Date.now() - dt.getTime();
  const diffSec = Math.max(0, Math.floor(diffMs / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}d ago`;
}

function updateRangeVisual(range, channelKey) {
  if (!range) return;
  const v = Math.max(0, Math.min(100, Number(range.value) || 0));
  const [r, g, b] = channelRgb[channelKey];
  range.style.background = `linear-gradient(90deg, rgba(${r}, ${g}, ${b}, 0.9) 0%, rgba(${r}, ${g}, ${b}, 0.9) ${v}%, rgba(14, 21, 47, 0.95) ${v}%, rgba(14, 21, 47, 0.95) 100%)`;
}

function createSliderRow(label, value, idx) {
  const row = document.createElement("div");
  row.className = `slider-row slider-ch${idx}`;

  const left = document.createElement("label");
  left.textContent = label;
  left.className = "slider-label";

  const range = document.createElement("input");
  range.type = "range";
  range.min = 0;
  range.max = 100;
  range.value = value;
  range.dataset.ch = idx;
  range.className = `manual-range ch${idx}`;

  const out = document.createElement("output");
  out.textContent = value;
  out.className = "slider-value";

  const applyManualValue = (next) => {
    let v = Math.max(0, Math.min(100, Number(next) || 0));
    if (isSnap5Enabled()) v = snapValue(v, 5);
    range.value = String(v);
    out.textContent = String(v);
    updateRangeVisual(range, `ch${idx}`);
    updateUnsavedIndicators();
  };

  range.addEventListener("input", () => {
    applyManualValue(range.value);
  });

  row.appendChild(left);
  row.appendChild(range);
  row.appendChild(out);
  updateRangeVisual(range, `ch${idx}`);
  return row;
}

function renderManual(intensity) {
  sliders.innerHTML = "";
  const vals = [intensity.ch1, intensity.ch2, intensity.ch3, intensity.ch4];
  vals.forEach((v, i) => sliders.appendChild(createSliderRow(channelLabels[i], v, i + 1)));
}

function renderProgram(program) {
  programBody.innerHTML = "";
  const points = [...(program?.points || [])].sort((a, b) => a.index - b.index);
  points.forEach((p) => addProgramRow(p));
  normalizeProgramRows();
  drawProgramChart(collectProgram(false).points);
}

function loadManualEditor(intensity) {
  if (!intensity) return;
  renderManual({
    ch1: Number(intensity.ch1) || 0,
    ch2: Number(intensity.ch2) || 0,
    ch3: Number(intensity.ch3) || 0,
    ch4: Number(intensity.ch4) || 0,
  });
  updateUnsavedIndicators();
}

function loadAutoEditor(program) {
  const points = Array.isArray(program?.points) ? program.points : [];
  renderProgram({ points });
  setAutoView("chart");
  updateUnsavedIndicators();
}

function setAutoView(mode) {
  autoViewMode = mode === "json" ? "json" : "chart";
  if (chartWrap) chartWrap.classList.toggle("is-hidden", autoViewMode !== "chart");
  if (stateView) stateView.classList.toggle("is-hidden", autoViewMode !== "json");
  if (autoViewChartBtn) autoViewChartBtn.classList.toggle("is-active", autoViewMode === "chart");
  if (autoViewJsonBtn) autoViewJsonBtn.classList.toggle("is-active", autoViewMode === "json");
}

function isSnap5Enabled() {
  return !!(manualSnap5Pct?.checked || autoSnap5Pct?.checked);
}

function getTimeSnapMinutes() {
  return snap15m?.checked ? 15 : 5;
}

function snapValue(value, step) {
  return Math.max(0, Math.min(100, Math.round(value / step) * step));
}

function snapTimeString(hhmm, stepMinutes) {
  const [h, m] = String(hhmm || "00:00").split(":").map(Number);
  const total = (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
  const snapped = Math.round(total / stepMinutes) * stepMinutes;
  const clamped = Math.max(0, Math.min(23 * 60 + 59, snapped));
  const sh = Math.floor(clamped / 60);
  const sm = clamped % 60;
  return `${String(sh).padStart(2, "0")}:${String(sm).padStart(2, "0")}`;
}

function isDesktopViewport() {
  return window.matchMedia("(min-width: 761px)").matches;
}

function updateTimePickerUI(row) {
  const tm = row?.querySelector(".tm");
  const display = row?.querySelector(".time-display");
  if (tm && display) display.textContent = tm.value || "00:00";
}

function destroyRowTimepicker(row) {
  const picker = row?._timepicker;
  if (picker && typeof picker.destroy === "function") picker.destroy();
  row._timepicker = null;
}

function setupRowTimepicker(row) {
  if (!row) return;
  const tm = row.querySelector(".tm");
  if (!tm) return;
  destroyRowTimepicker(row);
  updateTimePickerUI(row);

  if (!isDesktopViewport()) return;
  if (!window.TimepickerUI) return;

  const picker = new window.TimepickerUI(tm, {
    clock: {
      type: "24h",
      incrementHours: 1,
      incrementMinutes: getTimeSnapMinutes(),
    },
    ui: {
      theme: "dark",
      mobile: false,
      animation: true,
      backdrop: true,
      enableSwitchIcon: false,
    },
    callbacks: {
      onConfirm: () => {
        tm.value = snapTimeString(tm.value, getTimeSnapMinutes());
        updateTimePickerUI(row);
        normalizeProgramRows();
        const rowHasFocus = document.activeElement && row.contains(document.activeElement);
        if (rowHasFocus && chartController) {
          const [hour, minute] = tm.value.split(":").map(Number);
          chartController.setHoveredProgramPoint({
            row,
            hour: Number.isFinite(hour) ? hour : 0,
            minute: Number.isFinite(minute) ? minute : 0,
            ch1: Number(row.querySelector(".ch1")?.value) || 0,
            ch2: Number(row.querySelector(".ch2")?.value) || 0,
            ch3: Number(row.querySelector(".ch3")?.value) || 0,
            ch4: Number(row.querySelector(".ch4")?.value) || 0,
          });
        }
        drawProgramChart(collectProgram(false).points);
        updateUnsavedIndicators();
      },
    },
  });
  picker.create();
  row._timepicker = picker;
}

function refreshAllTimepickers() {
  for (const row of programBody.querySelectorAll("tr")) setupRowTimepicker(row);
}

function syncSnap5Checkboxes(source) {
  const val = !!source?.checked;
  if (manualSnap5Pct) manualSnap5Pct.checked = val;
  if (autoSnap5Pct) autoSnap5Pct.checked = val;
}

function canonicalIntensity(v) {
  if (!v) return null;
  if (v.ch1 === undefined || v.ch2 === undefined || v.ch3 === undefined || v.ch4 === undefined) return null;
  return {
    ch1: Number(v.ch1),
    ch2: Number(v.ch2),
    ch3: Number(v.ch3),
    ch4: Number(v.ch4),
  };
}

function canonicalProgramPoints(points) {
  const rows = [...(points || [])].map((p) => ({
    hour: Number(p.hour),
    minute: Number(p.minute),
    ch1: Number(p.ch1),
    ch2: Number(p.ch2),
    ch3: Number(p.ch3),
    ch4: Number(p.ch4),
  }));
  rows.sort((a, b) => (a.hour * 60 + a.minute) - (b.hour * 60 + b.minute));
  return rows;
}

function addProgramRow(p = null) {
  const tr = document.createElement("tr");
  const time = `${String(p?.hour ?? 12).padStart(2, "0")}:${String(p?.minute ?? 0).padStart(2, "0")}`;
  const values = [p?.ch1 ?? 0, p?.ch2 ?? 0, p?.ch3 ?? 0, p?.ch4 ?? 0];

  tr.innerHTML = `
    <td><span class="idx-label"></span></td>
    <td class="col-time">
      <div class="time-picker">
        <input type="time" step="300" value="${time}" class="tm"/>
        <button type="button" class="time-display">${time}</button>
      </div>
    </td>
    <td class="col-ch1">
      <div class="intensity-editor">
        <input type="range" min="0" max="100" value="${values[0]}" class="ch1"/>
        <output class="intensity-value">${values[0]}</output>
      </div>
    </td>
    <td class="col-ch2">
      <div class="intensity-editor">
        <input type="range" min="0" max="100" value="${values[1]}" class="ch2"/>
        <output class="intensity-value">${values[1]}</output>
      </div>
    </td>
    <td class="col-ch3">
      <div class="intensity-editor">
        <input type="range" min="0" max="100" value="${values[2]}" class="ch3"/>
        <output class="intensity-value">${values[2]}</output>
      </div>
    </td>
    <td class="col-ch4">
      <div class="intensity-editor">
        <input type="range" min="0" max="100" value="${values[3]}" class="ch4"/>
        <output class="intensity-value">${values[3]}</output>
      </div>
    </td>
    <td>
      <button class="rm icon-btn" type="button" title="Delete point" aria-label="Delete point">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 7h12M9 7V4h6v3m-7 4v6m4-6v6m4-10v12a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V7h8z"/>
        </svg>
      </button>
    </td>
  `;

  tr.querySelector(".rm").addEventListener("click", () => {
    removeProgramRow(tr);
  });
  const setHoveredFromRow = () => {
    const tm = tr.querySelector(".tm")?.value || "00:00";
    const [hour, minute] = tm.split(":").map(Number);
    if (!chartController) return;
    chartController.setHoveredProgramPoint({
      row: tr,
      hour: Number.isFinite(hour) ? hour : 0,
      minute: Number.isFinite(minute) ? minute : 0,
      ch1: Number(tr.querySelector(".ch1")?.value) || 0,
      ch2: Number(tr.querySelector(".ch2")?.value) || 0,
      ch3: Number(tr.querySelector(".ch3")?.value) || 0,
      ch4: Number(tr.querySelector(".ch4")?.value) || 0,
    });
    drawProgramChart(collectProgram(false).points);
  };
  tr.addEventListener("mouseenter", setHoveredFromRow);
  tr.addEventListener("focusin", setHoveredFromRow);
  tr.addEventListener("mouseleave", () => {
    if (chartController) chartController.setHoveredProgramPoint(null);
    drawProgramChart(collectProgram(false).points);
  });
  tr.querySelectorAll("input").forEach((el) => {
    el.addEventListener("input", () => {
      if (el.classList.contains("tm")) {
        el.step = String(getTimeSnapMinutes() * 60);
        el.value = snapTimeString(el.value, getTimeSnapMinutes());
        updateTimePickerUI(tr);
        normalizeProgramRows();
      } else if (/^ch[1-4]$/.test(el.className)) {
        let v = Number(el.value);
        if (isSnap5Enabled()) {
          v = snapValue(v, 5);
          el.value = String(v);
        }
        const out = el.closest(".intensity-editor")?.querySelector(".intensity-value");
        if (out) out.textContent = String(v);
        applyIntensityCellStyles(tr);
      }
      setHoveredFromRow();
      drawProgramChart(collectProgram(false).points);
      updateUnsavedIndicators();
    });
  });
  const displayBtn = tr.querySelector(".time-display");
  const tmInput = tr.querySelector(".tm");
  displayBtn?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    if (isDesktopViewport() && tr._timepicker) {
      tr._timepicker.open();
      return;
    }
    if (typeof tmInput.showPicker === "function") tmInput.showPicker();
    else tmInput.focus();
  });

  programBody.appendChild(tr);
  normalizeProgramRows();
  setupRowTimepicker(tr);
  updateTimePickerUI(tr);
  applyIntensityCellStyles(tr);
  drawProgramChart(collectProgram(false).points);
  updateUnsavedIndicators();
  return tr;
}

function collectIntensity() {
  const data = {};
  sliders.querySelectorAll("input[type='range']").forEach((el) => {
    data[`ch${el.dataset.ch}`] = Number(el.value);
  });
  return data;
}

function collectProgram(normalize = true) {
  if (normalize) normalizeProgramRows();
  const points = [...programBody.querySelectorAll("tr")].map((tr, i) => {
    const [hour, minute] = tr.querySelector(".tm").value.split(":").map(Number);
    return {
      index: i + 1,
      hour,
      minute,
      ch1: Number(tr.querySelector(".ch1").value),
      ch2: Number(tr.querySelector(".ch2").value),
      ch3: Number(tr.querySelector(".ch3").value),
      ch4: Number(tr.querySelector(".ch4").value),
    };
  });
  return { points };
}

function normalizeProgramRows() {
  const rows = [...programBody.querySelectorAll("tr")];
  const step = getTimeSnapMinutes();
  for (const row of rows) {
    const tm = row.querySelector(".tm");
    if (tm) {
      tm.step = String(step * 60);
      tm.value = snapTimeString(tm.value, step);
    }
    if (isSnap5Enabled()) {
      for (const cls of ["ch1", "ch2", "ch3", "ch4"]) {
        const el = row.querySelector(`.${cls}`);
        if (el) {
          el.value = String(snapValue(Number(el.value), 5));
          const out = el.closest(".intensity-editor")?.querySelector(".intensity-value");
          if (out) out.textContent = el.value;
        }
      }
    }
    applyIntensityCellStyles(row);
    updateTimePickerUI(row);
  }
  rows.sort((a, b) => {
    const ta = a.querySelector(".tm")?.value || "00:00";
    const tb = b.querySelector(".tm")?.value || "00:00";
    return ta.localeCompare(tb);
  });
  for (const row of rows) programBody.appendChild(row);
  rows.forEach((row, idx) => {
    const label = row.querySelector(".idx-label");
    if (label) label.textContent = String(idx + 1);
  });
}

function intensityOpacity(v) {
  if (v <= 0) return 0;
  if (v <= 30) return 0.1;
  if (v <= 60) return 0.2;
  return 0.35;
}

function applyIntensityCellStyles(row) {
  if (!row) return;
  for (const ch of ["ch1", "ch2", "ch3", "ch4"]) {
    const input = row.querySelector(`input.${ch}`);
    if (!input) continue;
    const out = row.querySelector(`td.col-${ch} .intensity-value`);
    const cell = input.closest(`td.col-${ch}`);
    const v = Math.max(0, Math.min(100, Number(input.value) || 0));
    if (out) out.textContent = String(v);
    if (v === 0) {
      if (cell) cell.style.backgroundColor = "#0e152f";
      continue;
    }
    const [r, g, b] = channelRgb[ch];
    const a = intensityOpacity(v);
    if (cell) cell.style.backgroundColor = `rgba(${r}, ${g}, ${b}, ${a})`;
  }
}

chartController = createChartController({
  programChart,
  chartLegend,
  chartWrap,
  channelLabels,
  channelColors,
  channelRgb,
  getProgramRowsData,
  getProgramPoints: () => collectProgram(false).points,
  getTimeSnapMinutes,
  isSnap5Enabled,
  snapValue,
  addProgramRow,
  removeProgramRow,
  applyIntensityCellStyles,
  updateTimePickerUI,
  normalizeProgramRows,
  isChartActive: () => autoViewMode === "chart",
  onDirtyChange: () => updateUnsavedIndicators(),
});

function renderChartLegend() {
  chartController.renderChartLegend();
}

function renderPresetMiniCharts() {
  chartController.renderPresetMiniCharts();
}

function drawProgramChart(points) {
  chartController.drawProgramChart(points);
}

function bindProgramChartInteractions() {
  chartController.bindProgramChartInteractions();
}

const modal = createModal({
  modal: uiModal,
  title: uiModalTitle,
  text: uiModalText,
  input: uiModalInput,
  cancel: uiModalCancel,
  ok: uiModalOk,
});
const askText = modal.askText;
const askConfirm = modal.askConfirm;

async function refreshState() {
  currentState = await api("/api/state");
  renderJSON(stateView, currentState);
  setActiveModeUI(currentState.mode);
  if (currentState.mode === "manual" && currentState.intensity) renderManual(currentState.intensity);
  if (currentState.mode === "auto" && currentState.program) {
    renderProgram(currentState.program);
    setAutoView(autoViewMode);
  }
  updateUnsavedIndicators();
}

function setActiveModeUI(reportedMode) {
  const mode = String(reportedMode || "").trim().toLowerCase();
  if (manualPanel) manualPanel.classList.toggle("is-hidden", mode !== "manual");
  if (autoPanel) autoPanel.classList.toggle("is-hidden", mode !== "auto");

  for (const btn of document.querySelectorAll(".mode-toggle .toggle-btn")) {
    const active = btn.dataset.mode === mode;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  }
}

function updateUnsavedIndicators() {
  const mode = String(currentState?.mode || "").toLowerCase();
  const deviceIntensity = canonicalIntensity(currentState?.intensity);
  const editorIntensity = canonicalIntensity(collectIntensity());
  const manualDirty =
    mode === "manual" && deviceIntensity && JSON.stringify(deviceIntensity) !== JSON.stringify(editorIntensity);

  if (manualUnsaved) manualUnsaved.classList.toggle("is-hidden", !manualDirty);

  const deviceProgram = canonicalProgramPoints(currentState?.program?.points || []);
  const editorProgram = canonicalProgramPoints(collectProgram(false).points || []);
  const autoDirty =
    mode === "auto" && deviceProgram.length > 0 && JSON.stringify(deviceProgram) !== JSON.stringify(editorProgram);

  if (autoUnsaved) autoUnsaved.classList.toggle("is-hidden", !autoDirty);
  if (applyProgramBtn) {
    const label = applyProgramBtn.querySelector("span");
    if (label) label.textContent = "Upload Program";
    else applyProgramBtn.textContent = "Upload Program";
  }
}

async function refreshValidation() {
  const latest = await api("/api/validation/latest");
  renderValidationBanner(latest);
}

async function refreshValidationPollingConfig() {
  const cfg = await api("/api/validation/polling");
  if (pollingEnabled) pollingEnabled.checked = !!cfg?.enabled;
  if (pollingIntervalMinutes) pollingIntervalMinutes.value = String(cfg?.interval_minutes || 1);
}

function renderValidationBanner(latest) {
  if (!validationBanner || !validationText) return;
  validationBanner.classList.remove("is-ok", "is-mismatch", "is-error", "is-skipped", "is-unknown");

  if (!latest || !latest.status) {
    validationBanner.classList.add("is-unknown");
    validationText.textContent = "Validation status unknown";
    return;
  }

  const status = String(latest.status).toLowerCase();
  const since = timeSince(latest.checked_at);
  const suffix = since ? ` - ${since}` : "";
  if (status === "ok") {
    validationBanner.classList.add("is-ok");
    validationText.textContent = `Program OK${suffix}`;
    return;
  }
  if (status === "mismatch") {
    validationBanner.classList.add("is-mismatch");
    validationText.textContent = `Invalid Program${suffix}`;
    return;
  }
  if (status === "error") {
    validationBanner.classList.add("is-error");
    validationText.textContent = `Validation failed${suffix}`;
    return;
  }
  if (status === "skipped") {
    validationBanner.classList.add("is-skipped");
    validationText.textContent = `Validation skipped${suffix}`;
    return;
  }

  validationBanner.classList.add("is-unknown");
  validationText.textContent = `Validation status: ${status}`;
}

for (const btn of document.querySelectorAll(".mode-btn")) {
  btn.addEventListener("click", async () => {
    await withButtonFeedback(btn, async () => {
      await api("/api/mode", { method: "POST", body: JSON.stringify({ mode: btn.dataset.mode }) });
      // Important: we only update visible mode based on the reported state.
      await refreshState();
    });
  });
}

document.getElementById("refresh-state").addEventListener("click", refreshState);
document.getElementById("run-validation").addEventListener("click", async (ev) => {
  await withButtonFeedback(ev.currentTarget, async () => {
    await api("/api/validation/run", { method: "POST" });
    await refreshValidation();
  });
});

if (savePollingConfigBtn) {
  savePollingConfigBtn.addEventListener("click", async (ev) => {
    await withButtonFeedback(ev.currentTarget, async () => {
      const minutes = Math.max(1, Math.min(1440, Number(pollingIntervalMinutes?.value || 1)));
      await api("/api/validation/polling", {
        method: "POST",
        body: JSON.stringify({
          enabled: !!pollingEnabled?.checked,
          interval_minutes: minutes,
        }),
      });
      await refreshValidationPollingConfig();
    });
  });
}

document.getElementById("apply-intensity").addEventListener("click", async (ev) => {
  await withButtonFeedback(ev.currentTarget, async () => {
    await api("/api/manual/intensity", { method: "POST", body: JSON.stringify(collectIntensity()) });
    await refreshState();
  });
});

document.getElementById("add-point").addEventListener("click", () => addProgramRow());

document.getElementById("discard-program").addEventListener("click", () => {
  if (!currentState?.program) return;
  loadAutoEditor(currentState.program);
  updateUnsavedIndicators();
});

document.getElementById("apply-program").addEventListener("click", async (ev) => {
  await withButtonFeedback(ev.currentTarget, async () => {
    await api("/api/program", { method: "POST", body: JSON.stringify(collectProgram()) });
    await refreshState();
    await refreshValidation();
  });
});

document.getElementById("save-manual-preset").addEventListener("click", async (ev) => {
  await withButtonFeedback(ev.currentTarget, async () => {
    const name = await askText("Save Manual Preset", "Enter preset name");
    if (!name) return;
    await api("/api/presets", {
      method: "POST",
      body: JSON.stringify({ name, mode: "manual", intensity: collectIntensity() }),
    });
    location.reload();
  });
});

document.getElementById("save-auto-preset").addEventListener("click", async (ev) => {
  await withButtonFeedback(ev.currentTarget, async () => {
    const name = await askText("Save Auto Preset", "Enter preset name");
    if (!name) return;
    await api("/api/presets", {
      method: "POST",
      body: JSON.stringify({ name, mode: "auto", program: collectProgram() }),
    });
    location.reload();
  });
});

for (const btn of document.querySelectorAll(".apply-preset")) {
  btn.addEventListener("click", async () => {
    await withButtonFeedback(btn, async () => {
      const res = await api(`/api/presets/${btn.dataset.id}/apply`, { method: "POST" });
      const preset = res?.loaded;
      if (!preset) return;
      if (preset.mode === "manual" && preset.intensity) loadManualEditor(preset.intensity);
      if (preset.mode === "auto" && preset.program) loadAutoEditor(preset.program);
    });
  });
}

for (const btn of document.querySelectorAll(".rename-preset-trigger")) {
  btn.addEventListener("click", async () => {
    await withButtonFeedback(btn, async () => {
      const visibleName =
        btn.closest(".preset-title-wrap")?.querySelector(".preset-title")?.textContent?.trim() || "";
      const currentName = btn.dataset.name || visibleName;
      const nextName = await askText("Edit Preset Name", "Update preset name", currentName);
      if (!nextName || nextName === currentName) return;
      await api(`/api/presets/${btn.dataset.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: nextName }),
      });
      location.reload();
    });
  });
}

for (const btn of document.querySelectorAll(".delete-preset")) {
  btn.addEventListener("click", async () => {
    await withButtonFeedback(btn, async () => {
      const ok = await askConfirm("Delete Preset", "Delete this preset?");
      if (!ok) return;
      await api(`/api/presets/${btn.dataset.id}`, { method: "DELETE" });
      location.reload();
    });
  });
}

if (autoViewChartBtn) autoViewChartBtn.addEventListener("click", () => setAutoView("chart"));
if (autoViewJsonBtn) autoViewJsonBtn.addEventListener("click", () => setAutoView("json"));
if (resetChartViewBtn) {
  resetChartViewBtn.addEventListener("click", () => {
    if (chartController) chartController.resetView();
  });
}
if (manualSnap5Pct) {
  manualSnap5Pct.addEventListener("change", (ev) => {
    syncSnap5Checkboxes(ev.currentTarget);
    normalizeProgramRows();
    drawProgramChart(collectProgram(false).points);
    updateUnsavedIndicators();
  });
}
if (autoSnap5Pct) {
  autoSnap5Pct.addEventListener("change", (ev) => {
    syncSnap5Checkboxes(ev.currentTarget);
    normalizeProgramRows();
    drawProgramChart(collectProgram(false).points);
    updateUnsavedIndicators();
  });
}
if (snap15m) {
  snap15m.addEventListener("change", () => {
    normalizeProgramRows();
    refreshAllTimepickers();
    drawProgramChart(collectProgram(false).points);
    updateUnsavedIndicators();
  });
}

modal.bindEvents();

refreshState().catch((err) => renderJSON(stateView, { error: String(err) }));
refreshValidation().catch(() => renderValidationBanner({ status: "error" }));
refreshValidationPollingConfig().catch(() => {});
renderChartLegend();
bindProgramChartInteractions();
setAutoView("chart");
window.addEventListener("resize", () => drawProgramChart(collectProgram(false).points));
window.addEventListener("resize", refreshAllTimepickers);
window.addEventListener("resize", renderPresetMiniCharts);
renderPresetMiniCharts();
