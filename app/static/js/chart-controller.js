export function createChartController(options) {
  const {
    programChart,
    chartLegend,
    chartWrap,
    channelLabels,
    channelColors,
    channelRgb,
    getProgramRowsData,
    getProgramPoints,
    getTimeSnapMinutes,
    isSnap5Enabled,
    snapValue,
    addProgramRow,
    removeProgramRow,
    applyIntensityCellStyles,
    updateTimePickerUI,
    normalizeProgramRows,
    isChartActive,
    onDirtyChange,
  } = options;

  let hoveredProgramPoint = null;
  let focusedChannel = null;
  let chartState = null;
  let chartDrag = null;
  let selectedChartPoint = null;
  let chartRangeSelect = null;
  let lastChartTap = { at: 0, x: 0, y: 0 };
  let chartView = { start: 0, end: 1440 };

  function clampChartView(start, end) {
    const minSpan = 30;
    let s = Math.max(0, Number(start) || 0);
    let e = Math.min(1440, Number(end) || 1440);
    if (e - s < minSpan) {
      const mid = (s + e) / 2;
      s = mid - minSpan / 2;
      e = mid + minSpan / 2;
    }
    if (s < 0) {
      e -= s;
      s = 0;
    }
    if (e > 1440) {
      s -= e - 1440;
      e = 1440;
    }
    s = Math.max(0, s);
    e = Math.min(1440, e);
    if (e - s < minSpan) e = Math.min(1440, s + minSpan);
    return { start: s, end: e };
  }

  function getChartTrash() {
    if (!chartWrap) return null;
    let trash = chartWrap.querySelector('.chart-trash');
    if (trash) return trash;
    trash = document.createElement('div');
    trash.className = 'chart-trash is-hidden';
    trash.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" d="M6 7h12M9 7V4h6v3m-7 4v6m4-6v6m4-10v12a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V7h8z"/>
      </svg>
    `;
    chartWrap.appendChild(trash);
    return trash;
  }

  function findSelectedMarker() {
    if (!selectedChartPoint || !chartState?.markers?.length) return null;
    return (
      chartState.markers.find(
        (m) => m.row === selectedChartPoint.row && m.channel === selectedChartPoint.channel,
      ) || null
    );
  }

  function positionTrashNearSelected() {
    const trash = getChartTrash();
    if (!trash || !chartWrap || !programChart) return;
    const marker = findSelectedMarker();
    if (!marker) return;

    const wrapRect = chartWrap.getBoundingClientRect();
    const canvasRect = programChart.getBoundingClientRect();
    const relX = canvasRect.left - wrapRect.left + marker.x;
    const relY = canvasRect.top - wrapRect.top + marker.y;

    const offsetX = 30;
    const offsetY = -30;
    const x = relX + offsetX;
    const y = relY + offsetY;

    trash.style.left = `${x}px`;
    trash.style.top = `${y}px`;
  }

  function clearSelectedPoint() {
    selectedChartPoint = null;
  }

  function selectChartPoint(marker) {
    if (!marker?.row) {
      clearSelectedPoint();
      return;
    }
    selectedChartPoint = {
      row: marker.row,
      channel: marker.channel,
    };
  }
function renderChartLegend() {
  if (!chartLegend) return;
  chartLegend.innerHTML = "";
  channelLabels.forEach((label, idx) => {
    const ch = idx + 1;
    const item = document.createElement("button");
    item.type = "button";
    item.className = "legend-item";
    item.dataset.channel = String(ch);
    item.innerHTML = `<span class="legend-swatch" style="background:${channelColors[idx]}"></span>${label}`;
    item.addEventListener("click", () => {
      focusedChannel = focusedChannel === ch ? null : ch;
      updateLegendFocusUI();
      drawProgramChart(getProgramPoints());
    });
    chartLegend.appendChild(item);
  });
  updateLegendFocusUI();
}

function updateLegendFocusUI() {
  if (!chartLegend) return;
  for (const el of chartLegend.querySelectorAll(".legend-item")) {
    const ch = Number(el.dataset.channel);
    const isActive = focusedChannel === null || focusedChannel === ch;
    const isSolo = focusedChannel !== null && focusedChannel === ch;
    el.classList.toggle("is-dim", !isActive);
    el.classList.toggle("is-solo", isSolo);
  }
}

function pointsFromProgram(programObj) {
  const raw = Array.isArray(programObj?.points) ? programObj.points : [];
  return raw
    .map((p) => ({
      hour: Number(p.hour),
      minute: Number(p.minute),
      ch1: Number(p.ch1),
      ch2: Number(p.ch2),
      ch3: Number(p.ch3),
      ch4: Number(p.ch4),
      minuteOfDay: Number(p.hour) * 60 + Number(p.minute),
    }))
    .sort((a, b) => a.minuteOfDay - b.minuteOfDay);
}

function drawMiniPresetChart(canvas, mode, intensityObj, programObj) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const cssW = Math.max(120, canvas.clientWidth || 120);
  const cssH = Math.max(42, canvas.clientHeight || 42);
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const css = getComputedStyle(document.documentElement);
  const bg = css.getPropertyValue("--deep-slate").trim() || "#0e152f";
  const grid = css.getPropertyValue("--spectrum-indigo").trim() || "#1c2e66";
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, cssW, cssH);
  ctx.strokeStyle = grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, cssH - 0.5);
  ctx.lineTo(cssW, cssH - 0.5);
  ctx.stroke();

  const m = { top: 4, right: 4, bottom: 4, left: 4 };
  const w = cssW - m.left - m.right;
  const h = cssH - m.top - m.bottom;
  const toX = (minute) => m.left + (minute / 1440) * w;
  const toY = (value) => m.top + ((100 - value) / 100) * h;

  let points = [];
  if (mode === "manual") {
    const i = intensityObj || {};
    points = [
      { minuteOfDay: 0, ch1: Number(i.ch1) || 0, ch2: Number(i.ch2) || 0, ch3: Number(i.ch3) || 0, ch4: Number(i.ch4) || 0 },
      { minuteOfDay: 1440, ch1: Number(i.ch1) || 0, ch2: Number(i.ch2) || 0, ch3: Number(i.ch3) || 0, ch4: Number(i.ch4) || 0 },
    ];
  } else {
    points = pointsFromProgram(programObj);
  }
  if (!points.length) return;

  for (let ch = 1; ch <= 4; ch += 1) {
    ctx.strokeStyle = channelColors[ch - 1];
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(toX(points[0].minuteOfDay), toY(Number(points[0][`ch${ch}`]) || 0));
    for (let i = 1; i < points.length; i += 1) {
      ctx.lineTo(toX(points[i].minuteOfDay), toY(Number(points[i][`ch${ch}`]) || 0));
    }
    ctx.stroke();
  }
}

function renderPresetMiniCharts() {
  const items = document.querySelectorAll(".preset-item");
  for (const item of items) {
    const mode = item.dataset.mode || "";
    let intensity = {};
    let program = {};
    try { intensity = JSON.parse(item.dataset.intensity || "{}"); } catch {}
    try { program = JSON.parse(item.dataset.program || "{}"); } catch {}

    const canvas = item.querySelector(".preset-mini-chart");
    if (canvas) drawMiniPresetChart(canvas, mode, intensity, program);

    const t = item.querySelector(".preset-time");
    if (t) {
      const raw = t.textContent.replace(/^Saved\s+/, "");
      const dt = new Date(raw);
      if (!Number.isNaN(dt.getTime())) {
        t.textContent = `Saved ${dt.toLocaleString()}`;
      }
    }
  }
}

function drawProgramChart(points) {
  if (!programChart) return;
  const ctx = programChart.getContext("2d");
  if (!ctx) return;
  const css = getComputedStyle(document.documentElement);
  const chartBg = css.getPropertyValue("--deep-slate").trim() || "#0e152f";
  const grid = css.getPropertyValue("--spectrum-indigo").trim() || "#1c2e66";
  const axisText = css.getPropertyValue("--muted-reef-gray").trim() || "#7e8bb8";
  const emptyText = css.getPropertyValue("--muted").trim() || "#7e8bb8";

  const cssW = Math.max(320, programChart.clientWidth || 320);
  const cssH = Math.max(200, programChart.clientHeight || 200);
  const dpr = window.devicePixelRatio || 1;
  programChart.width = Math.floor(cssW * dpr);
  programChart.height = Math.floor(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const w = cssW;
  const h = cssH;
  const m = { top: 16, right: 14, bottom: 28, left: 38 };
  const innerW = w - m.left - m.right;
  const innerH = h - m.top - m.bottom;

  const view = clampChartView(chartView.start, chartView.end);
  chartView = view;
  const viewStart = view.start;
  const viewEnd = view.end;
  const viewRange = Math.max(1, viewEnd - viewStart);

  const toX = (minute) => m.left + ((minute - viewStart) / viewRange) * innerW;
  const toY = (value) => m.top + ((100 - value) / 100) * innerH;
  const fromX = (x) => Math.max(0, Math.min(1440, viewStart + ((x - m.left) / innerW) * viewRange));
  const fromY = (y) => Math.max(0, Math.min(100, 100 - ((y - m.top) / innerH) * 100));

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = chartBg;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = grid;
  ctx.lineWidth = 1;
  for (let hh = 0; hh <= 24; hh += 1) {
    if (hh % 3 !== 0) continue;
    const x = toX(hh * 60);
    if (x < m.left || x > w - m.right) continue;
    ctx.beginPath();
    ctx.moveTo(x, m.top);
    ctx.lineTo(x, h - m.bottom);
    ctx.stroke();
  }
  for (let v = 0; v <= 100; v += 20) {
    const y = toY(v);
    ctx.beginPath();
    ctx.moveTo(m.left, y);
    ctx.lineTo(w - m.right, y);
    ctx.stroke();
  }

  ctx.fillStyle = axisText;
  ctx.font = "12px Space Grotesk, sans-serif";
  const rotateXAxisLabels = w < 520;
  const labelHourStep = rotateXAxisLabels ? 3 : 2;
  if (!rotateXAxisLabels) {
    ctx.textAlign = "center";
    for (let hh = 0; hh <= 24; hh += 1) {
      if (hh % labelHourStep !== 0) continue;
      const x = toX(hh * 60);
      if (x < m.left || x > w - m.right) continue;
      ctx.fillText(`${String(hh).padStart(2, "0")}:00`, x, h - 8);
    }
  } else {
    for (let hh = 0; hh <= 24; hh += 1) {
      if (hh % labelHourStep !== 0) continue;
      const x = toX(hh * 60);
      if (x < m.left || x > w - m.right) continue;
      ctx.save();
      ctx.translate(x, h - 7);
      ctx.rotate(-Math.PI / 4);
      ctx.textAlign = "right";
      ctx.fillText(`${String(hh).padStart(2, "0")}:00`, 0, 0);
      ctx.restore();
    }
  }
  ctx.textAlign = "right";
  for (let v = 0; v <= 100; v += 20) {
    ctx.fillText(String(v), m.left - 6, toY(v) + 4);
  }

  const domRows = getProgramRowsData();
  const normalized = (domRows.length ? domRows : [...(points || [])].map((p) => ({ ...p, row: null })))
    .map((p) => ({ ...p, minuteOfDay: (p.hour || 0) * 60 + (p.minute || 0) }))
    .sort((a, b) => a.minuteOfDay - b.minuteOfDay);

  if (!normalized.length) {
    ctx.fillStyle = emptyText;
    ctx.textAlign = "center";
    ctx.fillText("No program points yet", w / 2, h / 2);
    chartState = {
      w,
      h,
      m,
      toX,
      toY,
      fromX,
      fromY,
      markers: [],
      normalized: [],
      plot: { left: m.left, right: w - m.right, top: m.top, bottom: h - m.bottom },
    };
    return;
  }

  const interpolateAt = (channel, minute) => {
    const pts = normalized.map((p) => ({
      minute: p.minuteOfDay,
      value: Number(p[`ch${channel}`]) || 0,
    }));
    if (!pts.length) return 0;
    const ext = [
      { minute: pts[pts.length - 1].minute - 1440, value: pts[pts.length - 1].value },
      ...pts,
      { minute: pts[0].minute + 1440, value: pts[0].value },
    ];
    for (let i = 0; i < ext.length - 1; i += 1) {
      const a = ext[i];
      const b = ext[i + 1];
      if (minute >= a.minute && minute <= b.minute) {
        const span = b.minute - a.minute;
        if (span <= 0) return a.value;
        const t = (minute - a.minute) / span;
        return a.value + (b.value - a.value) * t;
      }
    }
    return ext[ext.length - 1].value;
  };

  if (hoveredProgramPoint) {
    const markerMinute = hoveredProgramPoint.hour * 60 + hoveredProgramPoint.minute;
    const x = toX(markerMinute);
    const markerColor = css.getPropertyValue("--neon-cyan").trim() || "#00e5ff";
    ctx.strokeStyle = markerColor;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(x, m.top);
    ctx.lineTo(x, h - m.bottom);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = markerColor;
    ctx.font = "11px Space Grotesk, sans-serif";
    ctx.textAlign = "center";
    const timeLabel = `${String(hoveredProgramPoint.hour).padStart(2, "0")}:${String(hoveredProgramPoint.minute).padStart(2, "0")}`;
    ctx.fillText(timeLabel, x, m.top - 4);
  }

  const markers = [];
  for (let ch = 1; ch <= 4; ch += 1) {
    const channelFocused = focusedChannel === null || focusedChannel === ch;
    ctx.globalAlpha = focusedChannel !== null && focusedChannel !== ch ? 0.18 : 1;
    ctx.strokeStyle = channelColors[ch - 1];
    ctx.lineWidth = 2;
    const pts = normalized.map((p) => ({
      minute: p.minuteOfDay,
      value: Number(p[`ch${ch}`]) || 0,
    }));

    const leftV = interpolateAt(ch, viewStart);
    const rightV = interpolateAt(ch, viewEnd);
    const visPts = pts.filter((p) => p.minute >= viewStart && p.minute <= viewEnd);

    ctx.beginPath();
    ctx.moveTo(toX(viewStart), toY(leftV));
    for (const p of visPts) ctx.lineTo(toX(p.minute), toY(p.value));
    ctx.lineTo(toX(viewEnd), toY(rightV));
    ctx.stroke();

    for (const p of normalized) {
      const x = toX(p.minuteOfDay);
      if (x < m.left - 10 || x > w - m.right + 10) continue;
      const y = toY(Number(p[`ch${ch}`]) || 0);
      ctx.fillStyle = channelColors[ch - 1];
      ctx.beginPath();
      ctx.arc(x, y, channelFocused ? 2.8 : 2, 0, Math.PI * 2);
      ctx.fill();
      const isSelected = selectedChartPoint
        && selectedChartPoint.row === p.row
        && selectedChartPoint.channel === ch;
      if (isSelected) {
        ctx.strokeStyle = "#d7e2ff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 7.2, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (channelFocused) {
        markers.push({
          row: p.row || null,
          minute: p.minuteOfDay,
          channel: ch,
          x,
          y,
          value: Number(p[`ch${ch}`]) || 0,
        });
      }
    }

    if (hoveredProgramPoint) {
      const x = toX(hoveredProgramPoint.hour * 60 + hoveredProgramPoint.minute);
      const y = toY(Number(hoveredProgramPoint[`ch${ch}`]) || 0);
      ctx.fillStyle = channelColors[ch - 1];
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#d7e2ff";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(x, y, 6.2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  chartState = {
    w,
    h,
    m,
    toX,
    toY,
    fromX,
    fromY,
    markers,
    normalized,
    interpolateAt,
    viewStart,
    viewEnd,
    viewRange,
    plot: { left: m.left, right: w - m.right, top: m.top, bottom: h - m.bottom },
  };
  if (chartRangeSelect?.active) {
    const a = Math.max(viewStart, Math.min(viewEnd, chartRangeSelect.startMinute));
    const b = Math.max(viewStart, Math.min(viewEnd, chartRangeSelect.currentMinute));
    const x1 = toX(Math.min(a, b));
    const x2 = toX(Math.max(a, b));
    ctx.fillStyle = "rgba(0, 229, 255, 0.14)";
    ctx.fillRect(x1, m.top, Math.max(1, x2 - x1), h - m.top - m.bottom);
    ctx.strokeStyle = css.getPropertyValue("--neon-cyan").trim() || "#00e5ff";
    ctx.lineWidth = 1.4;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(x1, m.top, Math.max(1, x2 - x1), h - m.top - m.bottom);
    ctx.setLineDash([]);
  }
  const trash = chartWrap?.querySelector(".chart-trash");
  if (trash && !trash.classList.contains("is-hidden")) positionTrashNearSelected();
}

function eventToCanvasPos(ev) {
  const rect = programChart.getBoundingClientRect();
  return {
    x: ((ev.clientX - rect.left) / rect.width) * (programChart.width / (window.devicePixelRatio || 1)),
    y: ((ev.clientY - rect.top) / rect.height) * (programChart.height / (window.devicePixelRatio || 1)),
    clientX: ev.clientX,
    clientY: ev.clientY,
  };
}

function nearestChartMarker(x, y, radius = 12) {
  if (!chartState?.markers?.length) return null;
  let best = null;
  let bestD2 = radius * radius;
  for (const m of chartState.markers) {
    const dx = m.x - x;
    const dy = m.y - y;
    const d2 = dx * dx + dy * dy;
    if (d2 <= bestD2) {
      best = m;
      bestD2 = d2;
    }
  }
  return best;
}

function buildChannelInterpolator(rows, channel) {
  const key = `ch${channel}`;
  const pts = [...rows]
    .map((r) => ({ minute: r.minuteOfDay, value: Number(r[key]) || 0 }))
    .sort((a, b) => a.minute - b.minute);
  if (!pts.length) return () => 0;
  const ext = [
    { minute: pts[pts.length - 1].minute - 1440, value: pts[pts.length - 1].value },
    ...pts,
    { minute: pts[0].minute + 1440, value: pts[0].value },
  ];
  return (minute) => {
    for (let i = 0; i < ext.length - 1; i += 1) {
      const a = ext[i];
      const b = ext[i + 1];
      if (minute >= a.minute && minute <= b.minute) {
        const span = b.minute - a.minute;
        if (span <= 0) return a.value;
        const t = (minute - a.minute) / span;
        return a.value + (b.value - a.value) * t;
      }
    }
    return ext[ext.length - 1].value;
  };
}

function interpolateChannelAtMinute(rows, channel, minute, excludeRow = null) {
  const key = `ch${channel}`;
  const pts = rows
    .filter((r) => !excludeRow || r.row !== excludeRow)
    .map((r) => ({ minute: r.minuteOfDay, value: Number(r[key]) || 0 }))
    .sort((a, b) => a.minute - b.minute);
  if (!pts.length) return 0;
  if (pts.length === 1) return pts[0].value;

  const ext = [
    { minute: pts[pts.length - 1].minute - 1440, value: pts[pts.length - 1].value },
    ...pts,
    { minute: pts[0].minute + 1440, value: pts[0].value },
  ];
  for (let i = 0; i < ext.length - 1; i += 1) {
    const a = ext[i];
    const b = ext[i + 1];
    if (minute >= a.minute && minute <= b.minute) {
      const span = b.minute - a.minute;
      if (span <= 0) return a.value;
      const t = (minute - a.minute) / span;
      return a.value + (b.value - a.value) * t;
    }
  }
  return ext[ext.length - 1].value;
}

function updateRowFromChartDrag(row, channel, minute, value) {
  if (!row) return;
  const snappedMinute = Math.round(minute / getTimeSnapMinutes()) * getTimeSnapMinutes();
  const safeMinute = Math.max(0, Math.min(1439, snappedMinute));
  const hour = Math.floor(safeMinute / 60);
  const min = safeMinute % 60;
  const tm = row.querySelector(".tm");
  if (tm) {
    tm.value = `${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
    updateTimePickerUI(row);
  }
  const input = row.querySelector(`.ch${channel}`);
  if (input) {
    let v = Math.max(0, Math.min(100, Math.round(value)));
    if (isSnap5Enabled()) v = snapValue(v, 5);
    input.value = String(v);
    const out = input.closest(".intensity-editor")?.querySelector(".intensity-value");
    if (out) out.textContent = String(v);
  }
  applyIntensityCellStyles(row);
}

function setRowChannelValue(row, channel, value) {
  const input = row?.querySelector(`.ch${channel}`);
  if (!input) return;
  let v = Math.max(0, Math.min(100, Math.round(value)));
  if (isSnap5Enabled()) v = snapValue(v, 5);
  input.value = String(v);
  const out = input.closest(".intensity-editor")?.querySelector(".intensity-value");
  if (out) out.textContent = String(v);
}

function isInTrash(clientX, clientY) {
  const trash = getChartTrash();
  if (!trash || trash.classList.contains("is-hidden")) return false;
  const rect = trash.getBoundingClientRect();
  return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
}

function setTrashVisible(visible, danger = false) {
  const trash = getChartTrash();
  if (!trash) return;
  trash.classList.toggle("is-hidden", !visible);
  trash.classList.toggle("is-danger", danger);
  if (visible) positionTrashNearSelected();
}

function addChartPointAt(x, y) {
  if (!chartState) return;
  const minute = chartState.fromX(x);
  const value = chartState.fromY(y);
  const snappedMinute = Math.round(minute / getTimeSnapMinutes()) * getTimeSnapMinutes();
  const safeMinute = Math.max(0, Math.min(1439, snappedMinute));
  const fallback = isSnap5Enabled() ? snapValue(Math.round(value), 5) : Math.round(value);
  const base = {
    ch1: chartState.interpolateAt ? Math.round(chartState.interpolateAt(1, safeMinute)) : fallback,
    ch2: chartState.interpolateAt ? Math.round(chartState.interpolateAt(2, safeMinute)) : fallback,
    ch3: chartState.interpolateAt ? Math.round(chartState.interpolateAt(3, safeMinute)) : fallback,
    ch4: chartState.interpolateAt ? Math.round(chartState.interpolateAt(4, safeMinute)) : fallback,
  };
  if (focusedChannel) {
    const k = `ch${focusedChannel}`;
    base[k] = isSnap5Enabled() ? snapValue(Math.round(value), 5) : Math.round(value);
  } else {
    const v = isSnap5Enabled() ? snapValue(Math.round(value), 5) : Math.round(value);
    base.ch1 = v;
    base.ch2 = v;
    base.ch3 = v;
    base.ch4 = v;
  }
  const hour = Math.floor(safeMinute / 60);
  const minutePart = safeMinute % 60;
  addProgramRow({ hour, minute: minutePart, ...base });
}

function bindProgramChartInteractions() {
  if (!programChart) return;
  const trash = getChartTrash();
  let pendingRelativeDrag = null;
  const setCursor = (name) => {
    programChart.style.cursor = name;
  };
  const updateChartCursor = (ev) => {
    if (!chartState || !isChartActive()) {
      setCursor("default");
      return;
    }
    const pos = eventToCanvasPos(ev);
    if (chartDrag) {
      const outside = pos.x < 0 || pos.x > chartState.w || pos.y < 0 || pos.y > chartState.h;
      const trashHit = isInTrash(pos.clientX, pos.clientY);
      setCursor(outside || trashHit ? "not-allowed" : "grabbing");
      return;
    }
    if (chartRangeSelect?.active) {
      setCursor("zoom-in");
      return;
    }
    const hit = nearestChartMarker(pos.x, pos.y, 14);
      if (hit) {
        setCursor("grab");
        return;
      }
    const inPlot = pos.x >= chartState.plot.left && pos.x <= chartState.plot.right
      && pos.y >= chartState.plot.top && pos.y <= chartState.plot.bottom;
    setCursor(inPlot ? "crosshair" : "default");
  };
  const startDragForMarker = (marker, eventObj, grabOffsetX = 0, grabOffsetY = 0) => {
    if (!marker?.row) return false;
    selectChartPoint(marker);
    const baselineRows = getProgramRowsData().map((r) => ({ ...r }));
    const baselineInterps = {
      1: buildChannelInterpolator(baselineRows, 1),
      2: buildChannelInterpolator(baselineRows, 2),
      3: buildChannelInterpolator(baselineRows, 3),
      4: buildChannelInterpolator(baselineRows, 4),
    };
    chartDrag = {
      pointerId: eventObj.pointerId,
      row: marker.row,
      channel: marker.channel,
      deleteOnDrop: false,
      startX: marker.x,
      startMinute: marker.minute,
      originalRow: marker.row,
      originalMinute: marker.minute,
      originalValue: marker.value,
      pendingSplit: focusedChannel !== null && focusedChannel === marker.channel,
      splitMode: false,
      baselineInterps,
      grabOffsetX,
      grabOffsetY,
    };
    setTrashVisible(false, false);
    setCursor("grabbing");
    programChart.setPointerCapture(eventObj.pointerId);
    drawProgramChart(getProgramPoints());
    eventObj.preventDefault();
    return true;
  };

  programChart.addEventListener("dblclick", (ev) => {
    if (!isChartActive()) return;
    const pos = eventToCanvasPos(ev);
    if (!chartState) return;
    if (pos.x < chartState.plot.left || pos.x > chartState.plot.right) return;
    if (pos.y < chartState.plot.top || pos.y > chartState.plot.bottom) return;
    addChartPointAt(pos.x, pos.y);
  });

  programChart.addEventListener("pointerdown", (ev) => {
    if (!isChartActive()) return;
    const pos = eventToCanvasPos(ev);
    const hit = nearestChartMarker(pos.x, pos.y, 14);
    if (startDragForMarker(hit, ev, pos.x - hit?.x, pos.y - hit?.y)) {
      pendingRelativeDrag = null;
      chartRangeSelect = null;
      return;
    }

    const selectedMarker = findSelectedMarker();
    if (selectedMarker?.row) {
      pendingRelativeDrag = {
        pointerId: ev.pointerId,
        marker: selectedMarker,
        startX: pos.x,
        startY: pos.y,
        grabOffsetX: pos.x - selectedMarker.x,
        grabOffsetY: pos.y - selectedMarker.y,
      };
      chartRangeSelect = null;
      return;
    }

    pendingRelativeDrag = null;
    clearSelectedPoint();
    setTrashVisible(false, false);
    drawProgramChart(getProgramPoints());
    if (chartState
      && pos.x >= chartState.plot.left
      && pos.x <= chartState.plot.right
      && pos.y >= chartState.plot.top
      && pos.y <= chartState.plot.bottom) {
      chartRangeSelect = {
        pointerId: ev.pointerId,
        startMinute: chartState.fromX(pos.x),
        currentMinute: chartState.fromX(pos.x),
        active: false,
        startX: pos.x,
      };
      programChart.setPointerCapture(ev.pointerId);
    } else {
      chartRangeSelect = null;
    }
    if (ev.pointerType === "touch") {
      const now = Date.now();
      const dx = pos.x - lastChartTap.x;
      const dy = pos.y - lastChartTap.y;
      if (now - lastChartTap.at < 320 && dx * dx + dy * dy < 28 * 28) {
        if (chartState && pos.x >= chartState.plot.left && pos.x <= chartState.plot.right
          && pos.y >= chartState.plot.top && pos.y <= chartState.plot.bottom) {
          addChartPointAt(pos.x, pos.y);
        }
        lastChartTap = { at: 0, x: 0, y: 0 };
      } else {
        lastChartTap = { at: now, x: pos.x, y: pos.y };
      }
    }
  });

  const finishDrag = (ev, cancelled = false) => {
    if (!chartDrag && chartRangeSelect && chartRangeSelect.pointerId === ev.pointerId) {
      const sel = chartRangeSelect;
      chartRangeSelect = null;
      try { programChart.releasePointerCapture(ev.pointerId); } catch {}
      if (!cancelled && sel.active) {
        const a = Math.min(sel.startMinute, sel.currentMinute);
        const b = Math.max(sel.startMinute, sel.currentMinute);
        if (b - a >= getTimeSnapMinutes()) {
          chartView = clampChartView(a, b);
        }
      }
      drawProgramChart(getProgramPoints());
      return;
    }
    if (!chartDrag && pendingRelativeDrag && pendingRelativeDrag.pointerId === ev.pointerId) {
      pendingRelativeDrag = null;
      clearSelectedPoint();
      setTrashVisible(false, false);
      drawProgramChart(getProgramPoints());
      onDirtyChange();
      return;
    }
    if (!chartDrag || chartDrag.pointerId !== ev.pointerId) return;
    const drag = chartDrag;
    const row = drag.row;
    const shouldDelete = drag.deleteOnDrop && !cancelled;
    chartDrag = null;
    pendingRelativeDrag = null;
    setTrashVisible(!!selectedChartPoint, false);
    try { programChart.releasePointerCapture(ev.pointerId); } catch {}
    setCursor("default");
    if (!row) return;
    if (shouldDelete) {
      if (drag.splitMode && drag.originalRow) {
        setRowChannelValue(drag.originalRow, drag.channel, drag.originalValue);
        applyIntensityCellStyles(drag.originalRow);
      }
      removeProgramRow(row);
      return;
    }
    normalizeProgramRows();
    drawProgramChart(getProgramPoints());
    onDirtyChange();
  };

  programChart.addEventListener("pointermove", (ev) => {
    if (!chartDrag && chartRangeSelect && chartRangeSelect.pointerId === ev.pointerId && chartState) {
      const pos = eventToCanvasPos(ev);
      chartRangeSelect.currentMinute = chartState.fromX(pos.x);
      if (Math.abs(pos.x - chartRangeSelect.startX) >= 6) chartRangeSelect.active = true;
      drawProgramChart(getProgramPoints());
      ev.preventDefault();
      return;
    }
    if (!chartDrag && pendingRelativeDrag && pendingRelativeDrag.pointerId === ev.pointerId) {
      const pos0 = eventToCanvasPos(ev);
      const dx = pos0.x - pendingRelativeDrag.startX;
      const dy = pos0.y - pendingRelativeDrag.startY;
      if (dx * dx + dy * dy >= 7 * 7) {
        const marker = findSelectedMarker() || pendingRelativeDrag.marker;
        if (marker?.row) {
          const started = startDragForMarker(
            marker,
            ev,
            pendingRelativeDrag.grabOffsetX,
            pendingRelativeDrag.grabOffsetY,
          );
          if (started) pendingRelativeDrag = null;
        }
      }
      if (!chartDrag) return;
    }
    if (!chartDrag || chartDrag.pointerId !== ev.pointerId || !chartState) return;
    const pos = eventToCanvasPos(ev);
    const dragX = pos.x - (chartDrag.grabOffsetX || 0);
    const dragY = pos.y - (chartDrag.grabOffsetY || 0);
    const outside = dragX < 0 || dragX > chartState.w || dragY < 0 || dragY > chartState.h;
    const trashHit = isInTrash(pos.clientX, pos.clientY);
    chartDrag.deleteOnDrop = outside || trashHit;
    setTrashVisible(false, false);
    updateChartCursor(ev);

    if (!chartDrag.deleteOnDrop) {
      const minute = chartState.fromX(dragX);
      const value = chartState.fromY(dragY);
      if (chartDrag.pendingSplit) {
        const movedHorizontally = Math.abs(dragX - chartDrag.startX) >= 8;
        if (movedHorizontally) {
          const snappedMinute = Math.round(minute / getTimeSnapMinutes()) * getTimeSnapMinutes();
          const safeMinute = Math.max(0, Math.min(1439, snappedMinute));
          const hour = Math.floor(safeMinute / 60);
          const minutePart = safeMinute % 60;
          const p = {
            hour,
            minute: minutePart,
            ch1: Math.round(chartDrag.baselineInterps[1](safeMinute)),
            ch2: Math.round(chartDrag.baselineInterps[2](safeMinute)),
            ch3: Math.round(chartDrag.baselineInterps[3](safeMinute)),
            ch4: Math.round(chartDrag.baselineInterps[4](safeMinute)),
          };
          p[`ch${chartDrag.channel}`] = Math.round(value);
          const splitRow = addProgramRow(p);
          chartDrag.row = splitRow;
          chartDrag.pendingSplit = false;
          chartDrag.splitMode = true;
        } else {
          // Vertical edit only before split: keep time fixed, update focused channel value.
          setRowChannelValue(chartDrag.row, chartDrag.channel, value);
          applyIntensityCellStyles(chartDrag.row);
        }
      } else if (chartDrag.splitMode) {
        const snappedMinute = Math.round(minute / getTimeSnapMinutes()) * getTimeSnapMinutes();
        const safeMinute = Math.max(0, Math.min(1439, snappedMinute));
        const hour = Math.floor(safeMinute / 60);
        const minutePart = safeMinute % 60;
        const tm = chartDrag.row.querySelector(".tm");
        if (tm) {
          tm.value = `${String(hour).padStart(2, "0")}:${String(minutePart).padStart(2, "0")}`;
          updateTimePickerUI(chartDrag.row);
        }
        for (let ch = 1; ch <= 4; ch += 1) {
          const v = ch === chartDrag.channel ? value : chartDrag.baselineInterps[ch](safeMinute);
          setRowChannelValue(chartDrag.row, ch, v);
        }
        // Keep the original point free: recompute focused channel from neighbors + dragged split point.
        if (chartDrag.originalRow) {
          const rowsNow = getProgramRowsData();
          const oldV = interpolateChannelAtMinute(
            rowsNow,
            chartDrag.channel,
            chartDrag.originalMinute,
            chartDrag.originalRow,
          );
          setRowChannelValue(chartDrag.originalRow, chartDrag.channel, oldV);
          applyIntensityCellStyles(chartDrag.originalRow);
        }
        applyIntensityCellStyles(chartDrag.row);
      } else {
        updateRowFromChartDrag(chartDrag.row, chartDrag.channel, minute, value);
      }
      if (hoveredProgramPoint?.row === chartDrag.row) {
        const tm = chartDrag.row.querySelector(".tm")?.value || "00:00";
        const [hour, minutePart] = tm.split(":").map(Number);
        hoveredProgramPoint.hour = Number(hour) || 0;
        hoveredProgramPoint.minute = Number(minutePart) || 0;
        hoveredProgramPoint.ch1 = Number(chartDrag.row.querySelector(".ch1")?.value) || 0;
        hoveredProgramPoint.ch2 = Number(chartDrag.row.querySelector(".ch2")?.value) || 0;
        hoveredProgramPoint.ch3 = Number(chartDrag.row.querySelector(".ch3")?.value) || 0;
        hoveredProgramPoint.ch4 = Number(chartDrag.row.querySelector(".ch4")?.value) || 0;
      }
      drawProgramChart(getProgramPoints());
      onDirtyChange();
    }
    ev.preventDefault();
  });

  programChart.addEventListener("pointerup", (ev) => finishDrag(ev, false));
  programChart.addEventListener("pointercancel", (ev) => finishDrag(ev, true));
  programChart.addEventListener("mousemove", updateChartCursor);
  programChart.addEventListener("mouseleave", () => {
    if (!chartDrag) setCursor("default");
  });

  if (trash && !trash.dataset.bound) {
    trash.dataset.bound = "1";
    trash.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (!selectedChartPoint?.row) return;
      removeProgramRow(selectedChartPoint.row);
      setTrashVisible(false, false);
    });
  }
}


  function setHoveredProgramPoint(point) {
    hoveredProgramPoint = point;
  }

  function onRowRemoved(row) {
    if (hoveredProgramPoint?.row === row) hoveredProgramPoint = null;
    if (selectedChartPoint?.row === row) clearSelectedPoint();
    setTrashVisible(!!selectedChartPoint || !!chartDrag, false);
  }

  function resetView() {
    chartView = { start: 0, end: 1440 };
    drawProgramChart(getProgramPoints());
  }

  return {
    drawProgramChart,
    renderChartLegend,
    renderPresetMiniCharts,
    bindProgramChartInteractions,
    setHoveredProgramPoint,
    onRowRemoved,
    resetView,
  };
}
