import * as crypto from 'crypto';
import { StoredData, ProjectStats, DailySnapshot, FileStats, DebugSessionStats } from './tracker';
import { EditorInfo } from './editorDetector';

function formatTime(seconds: number): string {
  if (seconds < 60) { return `${Math.round(seconds)}s`; }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) { return `${h}h ${m}m`; }
  return `${m}m`;
}

function pct(a: number, total: number): number {
  if (total === 0) { return 0; }
  return Math.round((a / total) * 100);
}

export function getDashboardHtml(
  data: StoredData,
  projects: ProjectStats[],
  last30: DailySnapshot[],
  topFiles: FileStats[],
  editorInfo: EditorInfo | null,
  debugStats: DebugSessionStats[],
): string {
  const today = new Date().toISOString().split('T')[0];
  const todayData = data.daily[today] ?? { totalSeconds: 0, typedSeconds: 0, aiSeconds: 0, pastedSeconds: 0, debugSeconds: 0, keystrokes: 0 };
  const totalAllTime = Object.values(data.files).reduce((s, f) => s + f.totalSeconds, 0);
  const typedAllTime = Object.values(data.files).reduce((s, f) => s + f.typedSeconds, 0);
  const aiAllTime = Object.values(data.files).reduce((s, f) => s + f.aiSeconds, 0);
  const pastedAllTime = Object.values(data.files).reduce((s, f) => s + f.pastedSeconds, 0);
  const debugAllTime = Object.values(data.files).reduce((s, f) => s + f.debugSeconds, 0);

  const nonce = crypto.randomBytes(16).toString('base64');

  const aiTools = Object.values(data.aiTools);
  const cliTools = Object.values(data.cliTools);
  const editors = Object.values(data.editors);

  // Editor display
  const editorName = editorInfo?.name ?? 'Unknown Editor';

  // Bar chart data for last 30 days (now with 3 segments)
  const maxDay = Math.max(...last30.map(d => d.totalSeconds), 1);
  const chartBars = last30.map(d => {
    const typedH = pct(d.typedSeconds, maxDay);
    const aiH = pct(d.aiSeconds, maxDay);
    const pastedH = pct(d.pastedSeconds, maxDay);
    const label = d.date.slice(5); // MM-DD
    return { date: d.date, label, typedH, aiH, pastedH, total: d.totalSeconds };
  });

  const barsHtml = chartBars.map(b => `
    <div class="bar-col" title="${b.date}: ${formatTime(b.total)}">
      <div class="bar-stack">
        <div class="bar-pasted" style="height:${b.pastedH}%"></div>
        <div class="bar-ai" style="height:${b.aiH}%"></div>
        <div class="bar-typed" style="height:${b.typedH}%"></div>
      </div>
      <div class="bar-label">${b.label}</div>
    </div>
  `).join('');

  const projectRows = projects.slice(0, 10).map(p => `
    <tr>
      <td class="td-name">${p.name}</td>
      <td>${formatTime(p.totalSeconds)}</td>
      <td>
        <div class="split-bar">
          <div class="split-typed" style="width:${pct(p.typedSeconds, p.totalSeconds)}%"></div>
          <div class="split-ai" style="width:${pct(p.aiSeconds, p.totalSeconds)}%"></div>
          <div class="split-pasted" style="width:${pct(p.pastedSeconds, p.totalSeconds)}%"></div>
        </div>
      </td>
      <td class="td-dim">${pct(p.aiSeconds, p.totalSeconds)}% AI</td>
      <td class="td-dim">${p.files.length} files</td>
    </tr>
  `).join('');

  const fileRows = topFiles.slice(0, 15).map(f => `
    <tr>
      <td class="td-name" title="${f.filePath}">${f.fileName}</td>
      <td class="td-dim">${f.project}</td>
      <td>${formatTime(f.totalSeconds)}</td>
      <td>
        <div class="split-bar">
          <div class="split-typed" style="width:${pct(f.typedSeconds, f.totalSeconds)}%"></div>
          <div class="split-ai" style="width:${pct(f.aiSeconds, f.totalSeconds)}%"></div>
          <div class="split-pasted" style="width:${pct(f.pastedSeconds, f.totalSeconds)}%"></div>
        </div>
      </td>
      <td class="td-dim">${f.keystrokes} keys</td>
    </tr>
  `).join('');

  // AI tools rows — combined extensions + CLI
  const aiExtRows = aiTools.map(t => `
    <tr>
      <td class="td-name"><span class="tool-badge badge-ext">EXT</span> ${t.displayName}</td>
      <td>${formatTime(t.activeSeconds)}</td>
      <td class="td-dim">${t.completionsAccepted} accepted</td>
    </tr>
  `).join('');

  const cliRows = cliTools.map(t => `
    <tr>
      <td class="td-name"><span class="tool-badge badge-cli">CLI</span> ${t.toolName}</td>
      <td>${formatTime(t.totalSeconds)}</td>
      <td class="td-dim">${t.totalSessions} sessions</td>
    </tr>
  `).join('');

  const allAiRows = (aiExtRows + cliRows) || `<tr><td colspan="3" class="td-empty">No AI tools detected yet</td></tr>`;

  // Debug session rows
  const debugRows = debugStats.length > 0
    ? debugStats.map(d => `
      <tr>
        <td class="td-name"><span class="tool-badge badge-dbg">${d.debugType}</span></td>
        <td>${formatTime(d.totalSeconds)}</td>
        <td class="td-dim">${d.totalSessions} sessions</td>
      </tr>
    `).join('')
    : `<tr><td colspan="3" class="td-empty">No debug sessions yet</td></tr>`;

  // Editor rows
  const editorRows = editors.length > 0
    ? editors.map(e => `
      <tr>
        <td class="td-name">${e.editorName}</td>
        <td>${formatTime(e.totalSeconds)}</td>
      </tr>
    `).join('')
    : `<tr><td colspan="2" class="td-empty">No editor data yet</td></tr>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<title>Waqt Dashboard</title>
<style nonce="${nonce}">
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    /* ── Theme-adaptive colors (VS Code CSS vars) ─────────────── */
    --bg: var(--vscode-editor-background, #0d0d0f);
    --surface: var(--vscode-sideBar-background, var(--vscode-editor-background, #141416));
    --surface2: var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-sideBar-background, #1a1a1d));
    --border: var(--vscode-panel-border, var(--vscode-widget-border, #252529));
    --text: var(--vscode-editor-foreground, #e8e8ec);
    --dim: var(--vscode-descriptionForeground, #6b6b7a);

    /* ── Waqt accent colors ───────────────────────────────────── */
    --waqt-typed: #4ade80;
    --waqt-ai: #a78bfa;
    --waqt-pasted: #fb923c;
    --waqt-debug: #f472b6;
    --waqt-accent: var(--vscode-statusBarItem-prominentForeground, #f59e0b);
    --waqt-info: #38bdf8;

    /* ── Fonts (from editor settings) ─────────────────────────── */
    --mono: var(--vscode-editor-font-family, 'Menlo', 'Consolas', monospace);
    --sans: var(--vscode-font-family, system-ui, -apple-system, sans-serif);
  }

  /* Light theme adjustments */
  body.vscode-light {
    --waqt-typed: #16a34a;
    --waqt-ai: #7c3aed;
    --waqt-pasted: #ea580c;
    --waqt-info: #0284c7;
  }

  /* High contrast adjustments */
  body.vscode-high-contrast {
    --waqt-typed: #22c55e;
    --waqt-ai: #c4b5fd;
    --waqt-pasted: #fdba74;
    --waqt-info: #38bdf8;
  }

  body {
    background: var(--bg);
    color: var(--text);
    font-family: var(--sans);
    font-size: 13px;
    line-height: 1.5;
    min-height: 100vh;
    padding: 0;
    overflow-x: hidden;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 28px 16px;
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    background: var(--bg);
    z-index: 10;
    flex-wrap: wrap;
    gap: 10px;
  }

  .logo {
    font-family: var(--mono);
    font-size: 15px;
    font-weight: 600;
    letter-spacing: 0.04em;
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .logo-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--waqt-accent); animation: pulse 2s infinite; }
  @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }

  .editor-badge {
    font-family: var(--mono);
    font-size: 10px;
    padding: 2px 8px;
    border-radius: 4px;
    background: var(--surface2);
    border: 1px solid var(--border);
    color: var(--dim);
    letter-spacing: 0.04em;
  }

  .header-actions { display: flex; gap: 8px; }

  .btn {
    font-family: var(--mono);
    font-size: 11px;
    padding: 5px 12px;
    border-radius: 4px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--dim);
    cursor: pointer;
    transition: all 0.15s;
  }
  .btn:hover { border-color: var(--waqt-accent); color: var(--waqt-accent); }
  .btn-danger:hover { border-color: #f87171; color: #f87171; }

  main { padding: 24px 28px; max-width: 1100px; overflow-x: hidden; }

  /* KPI ROW */
  .kpi-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 12px;
    margin-bottom: 28px;
  }

  .kpi {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px 18px;
    position: relative;
    overflow: hidden;
  }
  .kpi::before {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 2px;
  }
  .kpi-total::before { background: var(--waqt-accent); }
  .kpi-typed::before { background: var(--waqt-typed); }
  .kpi-ai::before { background: var(--waqt-ai); }
  .kpi-pasted::before { background: var(--waqt-pasted); }
  .kpi-debug::before { background: var(--waqt-debug); }
  .kpi-keys::before { background: var(--waqt-info); }

  .kpi-label {
    font-family: var(--mono);
    font-size: 10px;
    color: var(--dim);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    margin-bottom: 8px;
  }

  .kpi-value {
    font-family: var(--mono);
    font-size: 26px;
    font-weight: 600;
    line-height: 1;
    margin-bottom: 4px;
  }
  .kpi-total .kpi-value { color: var(--waqt-accent); }
  .kpi-typed .kpi-value { color: var(--waqt-typed); }
  .kpi-ai .kpi-value { color: var(--waqt-ai); }
  .kpi-pasted .kpi-value { color: var(--waqt-pasted); }
  .kpi-debug .kpi-value { color: var(--waqt-debug); }
  .kpi-keys .kpi-value { color: var(--waqt-info); }

  .kpi-sub { font-size: 11px; color: var(--dim); }

  /* SECTION */
  .section { margin-bottom: 28px; }
  .section-title {
    font-family: var(--mono);
    font-size: 11px;
    font-weight: 500;
    color: var(--dim);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    margin-bottom: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .section-title::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--border);
  }

  /* CHART */
  .chart-wrap {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px;
  }

  .chart-legend {
    display: flex;
    gap: 16px;
    margin-bottom: 12px;
  }
  .legend-item { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--dim); }
  .legend-dot { width: 8px; height: 8px; border-radius: 2px; }
  .legend-typed { background: var(--waqt-typed); }
  .legend-ai { background: var(--waqt-ai); }
  .legend-pasted { background: var(--waqt-pasted); }

  .bar-chart {
    display: flex;
    align-items: flex-end;
    gap: 3px;
    height: 120px;
    padding-bottom: 24px;
    position: relative;
  }

  .bar-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    height: 100%;
    cursor: pointer;
  }

  .bar-stack {
    flex: 1;
    width: 100%;
    display: flex;
    flex-direction: column-reverse;
    border-radius: 2px 2px 0 0;
    overflow: hidden;
    min-height: 2px;
  }

  .bar-typed {
    background: var(--waqt-typed);
    opacity: 0.8;
    transition: opacity 0.15s;
  }
  .bar-ai {
    background: var(--waqt-ai);
    opacity: 0.8;
    transition: opacity 0.15s;
  }
  .bar-pasted {
    background: var(--waqt-pasted);
    opacity: 0.8;
    transition: opacity 0.15s;
  }
  .bar-col:hover .bar-typed,
  .bar-col:hover .bar-ai,
  .bar-col:hover .bar-pasted { opacity: 1; }

  .bar-label {
    position: absolute;
    bottom: 0;
    font-family: var(--mono);
    font-size: 9px;
    color: var(--dim);
    white-space: nowrap;
    margin-top: 4px;
  }

  /* Show every label by default, hide at narrow widths via nth-child */
  .bar-col .bar-label { display: none; }
  .bar-col:nth-child(3n+1) .bar-label { display: block; }
  .bar-chart:hover .bar-col .bar-label { display: block; }

  /* TABLES */
  .table-wrap {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow-x: auto;
  }

  table { width: 100%; border-collapse: collapse; min-width: 300px; }

  th {
    font-family: var(--mono);
    font-size: 10px;
    font-weight: 500;
    color: var(--dim);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    text-align: left;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
    background: var(--surface2);
  }

  td {
    padding: 9px 14px;
    border-bottom: 1px solid var(--border);
    font-family: var(--mono);
    font-size: 12px;
  }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: var(--surface2); }

  .td-name { font-weight: 500; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .td-dim { color: var(--dim); }
  .td-empty { color: var(--dim); text-align: center; padding: 24px; font-style: italic; }

  .split-bar {
    display: flex;
    height: 6px;
    border-radius: 3px;
    background: var(--surface2);
    overflow: hidden;
    width: 100px;
  }
  .split-typed { background: var(--waqt-typed); opacity: 0.8; }
  .split-ai { background: var(--waqt-ai); opacity: 0.8; }
  .split-pasted { background: var(--waqt-pasted); opacity: 0.8; }

  /* TOOL BADGES */
  .tool-badge {
    font-family: var(--mono);
    font-size: 9px;
    font-weight: 600;
    padding: 1px 5px;
    border-radius: 3px;
    letter-spacing: 0.04em;
    margin-right: 6px;
  }
  .badge-ext { background: var(--waqt-ai); color: var(--bg); }
  .badge-cli { background: var(--waqt-pasted); color: var(--bg); }
  .badge-dbg { background: var(--waqt-debug); color: var(--bg); }

  /* GRID LAYOUTS */
  .two-col { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }
  .three-col { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }

  /* TODAY RING */
  .today-section {
    display: flex;
    gap: 20px;
    align-items: center;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px 20px;
    margin-bottom: 28px;
  }

  .ring-wrap { position: relative; width: 80px; height: 80px; flex-shrink: 0; }
  .ring-label {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }
  .ring-time { font-family: var(--mono); font-size: 14px; font-weight: 600; }
  .ring-sub { font-size: 9px; color: var(--dim); font-family: var(--mono); }

  svg.ring { transform: rotate(-90deg); }
  .ring-track { fill: none; stroke: var(--border); stroke-width: 6; }
  .ring-fill-typed { fill: none; stroke: var(--waqt-typed); stroke-width: 6; stroke-linecap: round; }
  .ring-fill-ai { fill: none; stroke: var(--waqt-ai); stroke-width: 6; stroke-linecap: round; }
  .ring-fill-pasted { fill: none; stroke: var(--waqt-pasted); stroke-width: 6; stroke-linecap: round; }

  .today-stats { display: flex; flex-direction: column; gap: 8px; }
  .today-row { display: flex; align-items: center; gap: 10px; font-family: var(--mono); font-size: 12px; }
  .today-dot { width: 8px; height: 8px; border-radius: 2px; flex-shrink: 0; }
  .today-row-val { font-weight: 500; min-width: 48px; }
  .today-row-label { color: var(--dim); font-size: 11px; }

  .section-link {
    font-family: var(--mono);
    font-size: 10px;
    color: var(--dim);
    margin-left: auto;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  /* ── Responsive breakpoints ──────────────────────────────── */

  @media (max-width: 700px) {
    header { padding: 14px 16px 12px; }
    main { padding: 16px; }

    .kpi-grid { grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 8px; }
    .kpi { padding: 12px 14px; }
    .kpi-value { font-size: 20px; }

    .today-section { flex-direction: column; align-items: flex-start; gap: 14px; }

    .bar-chart { height: 90px; gap: 2px; }
    .bar-col:nth-child(3n+1) .bar-label { display: none; }
    .bar-col:nth-child(5n+1) .bar-label { display: block; }

    .chart-legend { flex-wrap: wrap; gap: 10px; }

    .two-col, .three-col { grid-template-columns: 1fr; }

    .split-bar { width: 70px; }
    .td-name { max-width: 140px; }

    td { padding: 7px 10px; font-size: 11px; }
    th { padding: 8px 10px; }
  }

  @media (max-width: 420px) {
    header { padding: 10px 12px; }
    main { padding: 12px; }

    .logo { font-size: 13px; gap: 6px; }
    .editor-badge { font-size: 9px; padding: 1px 6px; }
    .btn { font-size: 10px; padding: 4px 8px; }

    .kpi-grid { grid-template-columns: 1fr 1fr; gap: 6px; }
    .kpi-value { font-size: 18px; }
    .kpi-label { font-size: 9px; }

    .ring-wrap { width: 64px; height: 64px; }
    .ring-time { font-size: 12px; }

    .bar-chart { height: 70px; padding-bottom: 18px; }
    .bar-col:nth-child(5n+1) .bar-label { display: none; }
    .bar-col:nth-child(7n+1) .bar-label { display: block; }

    .today-row { font-size: 11px; gap: 6px; }
    .today-row-val { min-width: 40px; }
  }
</style>
</head>
<body>

<header>
  <div class="logo">
    <div class="logo-dot"></div>
    WAQT
    <span class="editor-badge">${editorName}</span>
  </div>
  <div class="header-actions">
    <button class="btn" onclick="refreshDashboard()">↻ Refresh</button>
    <button class="btn btn-danger" onclick="resetStats()">⚠ Reset</button>
  </div>
</header>

<main>

  <!-- KPIs -->
  <div class="kpi-grid">
    <div class="kpi kpi-total">
      <div class="kpi-label">Total All-Time</div>
      <div class="kpi-value">${formatTime(totalAllTime)}</div>
      <div class="kpi-sub">${Object.keys(data.files).length} files tracked</div>
    </div>
    <div class="kpi kpi-typed">
      <div class="kpi-label">You Typed</div>
      <div class="kpi-value">${formatTime(typedAllTime)}</div>
      <div class="kpi-sub">${pct(typedAllTime, totalAllTime)}% of total</div>
    </div>
    <div class="kpi kpi-ai">
      <div class="kpi-label">AI Assisted</div>
      <div class="kpi-value">${formatTime(aiAllTime)}</div>
      <div class="kpi-sub">${pct(aiAllTime, totalAllTime)}% of total</div>
    </div>
    <div class="kpi kpi-pasted">
      <div class="kpi-label">Pasted / External</div>
      <div class="kpi-value">${formatTime(pastedAllTime)}</div>
      <div class="kpi-sub">${pct(pastedAllTime, totalAllTime)}% of total</div>
    </div>
    <div class="kpi kpi-debug">
      <div class="kpi-label">Debugging</div>
      <div class="kpi-value">${formatTime(debugAllTime)}</div>
      <div class="kpi-sub">${debugStats.length} session type${debugStats.length !== 1 ? 's' : ''}</div>
    </div>
    <div class="kpi kpi-keys">
      <div class="kpi-label">Keystrokes</div>
      <div class="kpi-value">${Object.values(data.files).reduce((s, f) => s + f.keystrokes, 0).toLocaleString()}</div>
      <div class="kpi-sub">all time</div>
    </div>
  </div>

  <!-- TODAY -->
  <div class="section-title">Today</div>
  <div class="today-section">
    <div class="ring-wrap">
      ${buildRing(todayData.typedSeconds, todayData.aiSeconds, todayData.pastedSeconds, todayData.totalSeconds)}
      <div class="ring-label">
        <div class="ring-time">${formatTime(todayData.totalSeconds)}</div>
        <div class="ring-sub">today</div>
      </div>
    </div>
    <div class="today-stats">
      <div class="today-row">
        <div class="today-dot" style="background:var(--waqt-typed)"></div>
        <div class="today-row-val">${formatTime(todayData.typedSeconds)}</div>
        <div class="today-row-label">typed by you (${pct(todayData.typedSeconds, todayData.totalSeconds)}%)</div>
      </div>
      <div class="today-row">
        <div class="today-dot" style="background:var(--waqt-ai)"></div>
        <div class="today-row-val">${formatTime(todayData.aiSeconds)}</div>
        <div class="today-row-label">AI-assisted (${pct(todayData.aiSeconds, todayData.totalSeconds)}%)</div>
      </div>
      <div class="today-row">
        <div class="today-dot" style="background:var(--waqt-pasted)"></div>
        <div class="today-row-val">${formatTime(todayData.pastedSeconds)}</div>
        <div class="today-row-label">pasted / external (${pct(todayData.pastedSeconds, todayData.totalSeconds)}%)</div>
      </div>
      <div class="today-row">
        <div class="today-dot" style="background:var(--waqt-debug)"></div>
        <div class="today-row-val">${formatTime(todayData.debugSeconds)}</div>
        <div class="today-row-label">debugging (${pct(todayData.debugSeconds, todayData.totalSeconds)}%)</div>
      </div>
      <div class="today-row">
        <div class="today-dot" style="background:var(--waqt-info)"></div>
        <div class="today-row-val">${todayData.keystrokes.toLocaleString()}</div>
        <div class="today-row-label">keystrokes today</div>
      </div>
    </div>
  </div>

  <!-- 30-DAY CHART -->
  <div class="section">
    <div class="section-title">Last 30 Days</div>
    <div class="chart-wrap">
      <div class="chart-legend">
        <div class="legend-item"><div class="legend-dot legend-typed"></div>You typed</div>
        <div class="legend-item"><div class="legend-dot legend-ai"></div>AI assisted</div>
        <div class="legend-item"><div class="legend-dot legend-pasted"></div>Pasted / External</div>
      </div>
      <div class="bar-chart">
        ${barsHtml}
      </div>
    </div>
  </div>

  <!-- PROJECTS + AI TOOLS + EDITORS -->
  <div class="three-col">
    <div class="section">
      <div class="section-title">Projects</div>
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>Project</th><th>Time</th><th>Split</th><th>AI%</th><th>Files</th>
          </tr></thead>
          <tbody>${projectRows || `<tr><td colspan="5" class="td-empty">No data yet</td></tr>`}</tbody>
        </table>
      </div>
    </div>

    <div class="section">
      <div class="section-title">AI Tools</div>
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>Tool</th><th>Active Time</th><th>Details</th>
          </tr></thead>
          <tbody>${allAiRows}</tbody>
        </table>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Debug Sessions</div>
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>Type</th><th>Time</th><th>Sessions</th>
          </tr></thead>
          <tbody>${debugRows}</tbody>
        </table>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Editors</div>
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>Editor</th><th>Time</th>
          </tr></thead>
          <tbody>${editorRows}</tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- TOP FILES -->
  <div class="section">
    <div class="section-title">Top Files</div>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>File</th><th>Project</th><th>Time</th><th>Typed / AI / Pasted</th><th>Keystrokes</th>
        </tr></thead>
        <tbody>${fileRows || `<tr><td colspan="5" class="td-empty">No files tracked yet — start coding!</td></tr>`}</tbody>
      </table>
    </div>
  </div>

</main>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  function refreshDashboard() {
    vscode.postMessage({ command: 'refresh' });
  }
  function resetStats() {
    if (confirm('Reset ALL Waqt stats? This cannot be undone.')) {
      vscode.postMessage({ command: 'reset' });
    }
  }
</script>
</body>
</html>`;
}

function buildRing(typed: number, ai: number, pasted: number, total: number): string {
  const r = 34;
  const cx = 40;
  const cy = 40;
  const circ = 2 * Math.PI * r;

  const typedFrac = total > 0 ? typed / total : 0;
  const aiFrac = total > 0 ? ai / total : 0;
  const pastedFrac = total > 0 ? pasted / total : 0;

  const typedLen = typedFrac * circ;
  const aiLen = aiFrac * circ;
  const pastedLen = pastedFrac * circ;
  const aiOffset = -(typedLen);
  const pastedOffset = -(typedLen + aiLen);

  return `<svg class="ring" width="80" height="80" viewBox="0 0 80 80">
    <circle class="ring-track" cx="${cx}" cy="${cy}" r="${r}"/>
    <circle class="ring-fill-typed" cx="${cx}" cy="${cy}" r="${r}"
      stroke-dasharray="${typedLen} ${circ - typedLen}"
      stroke-dashoffset="0"/>
    <circle class="ring-fill-ai" cx="${cx}" cy="${cy}" r="${r}"
      stroke-dasharray="${aiLen} ${circ - aiLen}"
      stroke-dashoffset="${aiOffset}"/>
    <circle class="ring-fill-pasted" cx="${cx}" cy="${cy}" r="${r}"
      stroke-dasharray="${pastedLen} ${circ - pastedLen}"
      stroke-dashoffset="${pastedOffset}"/>
  </svg>`;
}
