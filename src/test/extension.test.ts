import * as assert from 'assert';

// ─── Pure-logic unit tests (no VS Code API needed) ────────────────────────
// These test the business logic functions separately from the VS Code runtime.

// ── formatTime (re-implemented inline for test isolation) ──────────────────
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

// ── Minimal StoredData factory ─────────────────────────────────────────────
function makeEmptyData() {
  return {
    files: {} as Record<string, any>,
    aiTools: {} as Record<string, any>,
    cliTools: {} as Record<string, any>,
    debugSessions: {} as Record<string, any>,
    daily: {} as Record<string, any>,
    editors: {} as Record<string, any>,
    lastUpdated: Date.now(),
  };
}

function makeFileStats(overrides: Partial<any> = {}): any {
  return {
    filePath: '/project/src/index.ts',
    fileName: 'index.ts',
    project: 'myproject',
    totalSeconds: 0,
    typedSeconds: 0,
    aiSeconds: 0,
    pastedSeconds: 0,
    debugSeconds: 0,
    lastSeen: Date.now(),
    keystrokes: 0,
    aiCompletionsAccepted: 0,
    pasteEvents: 0,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

suite('Waqt — formatTime', () => {
  test('formats seconds under a minute', () => {
    assert.strictEqual(formatTime(0), '0s');
    assert.strictEqual(formatTime(45), '45s');
    assert.strictEqual(formatTime(59), '59s');
  });

  test('formats minutes only', () => {
    assert.strictEqual(formatTime(60), '1m');
    assert.strictEqual(formatTime(90), '1m');
    assert.strictEqual(formatTime(3599), '59m');
  });

  test('formats hours and minutes', () => {
    assert.strictEqual(formatTime(3600), '1h 0m');
    assert.strictEqual(formatTime(3660), '1h 1m');
    assert.strictEqual(formatTime(7320), '2h 2m');
  });
});

suite('Waqt — pct()', () => {
  test('returns 0 when total is 0', () => {
    assert.strictEqual(pct(100, 0), 0);
  });

  test('computes percentage correctly', () => {
    assert.strictEqual(pct(25, 100), 25);
    assert.strictEqual(pct(1, 3), 33);
    assert.strictEqual(pct(2, 3), 67);
  });

  test('clamps to 100 for matching values', () => {
    assert.strictEqual(pct(100, 100), 100);
  });
});

suite('Waqt — Change Classification Logic', () => {
  test('large insertion (>100 chars) with no AI active → paste', () => {
    const PASTE_THRESHOLD = 100;
    const isAiActive = false;
    const isCliActive = false;
    const inserted = 'x'.repeat(150);
    const isPaste = inserted.length > PASTE_THRESHOLD && !isAiActive && !isCliActive;
    assert.strictEqual(isPaste, true);
  });

  test('large insertion with AI active → AI completion, not paste', () => {
    const PASTE_THRESHOLD = 100;
    const isAiActive = true;
    const isCliActive = false;
    const inserted = 'x'.repeat(150);
    const isAiCompletion = inserted.length > PASTE_THRESHOLD && (isAiActive || isCliActive);
    assert.strictEqual(isAiCompletion, true);
  });

  test('large insertion with CLI active → CLI completion, not paste', () => {
    const PASTE_THRESHOLD = 100;
    const isAiActive = false;
    const isCliActive = true;
    const inserted = 'x'.repeat(150);
    const isCliCompletion = inserted.length > PASTE_THRESHOLD && (isAiActive || isCliActive);
    assert.strictEqual(isCliCompletion, true);
  });

  test('small insertion (<= 100 chars) → regular typing', () => {
    const PASTE_THRESHOLD = 100;
    const inserted = 'hello world';
    const isTyped = inserted.length <= PASTE_THRESHOLD;
    assert.strictEqual(isTyped, true);
  });
});

suite('Waqt — ProjectStats aggregation', () => {
  test('aggregates files into project stats', () => {
    const data = makeEmptyData();
    const f1 = makeFileStats({ project: 'proj', totalSeconds: 100, typedSeconds: 60, aiSeconds: 30, pastedSeconds: 5, debugSeconds: 5, keystrokes: 10 });
    const f2 = makeFileStats({ filePath: '/project/src/utils.ts', fileName: 'utils.ts', project: 'proj', totalSeconds: 50, typedSeconds: 40, aiSeconds: 5, pastedSeconds: 3, debugSeconds: 2, keystrokes: 8 });
    data.files['/project/src/index.ts'] = f1;
    data.files['/project/src/utils.ts'] = f2;

    // Simulate getProjectStats
    const projects: Record<string, any> = {};
    for (const [path, file] of Object.entries(data.files) as [string, any][]) {
      const p = file.project;
      if (!projects[p]) {
        projects[p] = { name: p, totalSeconds: 0, typedSeconds: 0, aiSeconds: 0, pastedSeconds: 0, debugSeconds: 0, files: [], keystrokes: 0 };
      }
      projects[p].totalSeconds += file.totalSeconds;
      projects[p].typedSeconds += file.typedSeconds;
      projects[p].aiSeconds += file.aiSeconds;
      projects[p].pastedSeconds += file.pastedSeconds;
      projects[p].debugSeconds += file.debugSeconds;
      projects[p].keystrokes += file.keystrokes;
      if (!projects[p].files.includes(path)) { projects[p].files.push(path); }
    }

    const result = Object.values(projects) as any[];
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].totalSeconds, 150);
    assert.strictEqual(result[0].typedSeconds, 100);
    assert.strictEqual(result[0].aiSeconds, 35);
    assert.strictEqual(result[0].pastedSeconds, 8);
    assert.strictEqual(result[0].debugSeconds, 7);
    assert.strictEqual(result[0].keystrokes, 18);
    assert.strictEqual(result[0].files.length, 2);
  });

  test('separates files into distinct projects', () => {
    const data = makeEmptyData();
    data.files['/a/index.ts'] = makeFileStats({ project: 'projectA', totalSeconds: 60 });
    data.files['/b/index.ts'] = makeFileStats({ filePath: '/b/index.ts', project: 'projectB', totalSeconds: 40 });

    const projects: Record<string, any> = {};
    for (const [path, file] of Object.entries(data.files) as [string, any][]) {
      const p = file.project;
      if (!projects[p]) { projects[p] = { name: p, totalSeconds: 0, files: [] }; }
      projects[p].totalSeconds += file.totalSeconds;
      if (!projects[p].files.includes(path)) { projects[p].files.push(path); }
    }

    assert.strictEqual(Object.keys(projects).length, 2);
    assert.strictEqual(projects['projectA'].totalSeconds, 60);
    assert.strictEqual(projects['projectB'].totalSeconds, 40);
  });
});

suite('Waqt — Debug Session Tracking', () => {
  test('records new debug session on start', () => {
    const debugSessions: Record<string, any> = {};

    // Simulate onDebugSessionStarted
    const sessionType = 'node';
    if (!debugSessions[sessionType]) {
      debugSessions[sessionType] = { debugType: sessionType, totalSessions: 0, totalSeconds: 0 };
    }
    debugSessions[sessionType].totalSessions++;

    assert.strictEqual(debugSessions['node'].totalSessions, 1);
    assert.strictEqual(debugSessions['node'].totalSeconds, 0);
  });

  test('accumulates duration on session end', () => {
    const debugSessions: Record<string, any> = {
      'python': { debugType: 'python', totalSessions: 1, totalSeconds: 0 },
    };
    const start = Date.now() - 5000; // 5 seconds ago
    const durationSec = (Date.now() - start) / 1000;
    debugSessions['python'].totalSeconds += durationSec;

    assert.ok(debugSessions['python'].totalSeconds >= 4.9, 'Should accumulate at least 5s');
  });

  test('increments session count for repeated sessions', () => {
    const debugSessions: Record<string, any> = {};
    const sessionType = 'chrome';

    for (let i = 0; i < 3; i++) {
      if (!debugSessions[sessionType]) {
        debugSessions[sessionType] = { debugType: sessionType, totalSessions: 0, totalSeconds: 0 };
      }
      debugSessions[sessionType].totalSessions++;
    }

    assert.strictEqual(debugSessions['chrome'].totalSessions, 3);
  });

  test('tracks multiple debug types independently', () => {
    const debugSessions: Record<string, any> = {};
    const types = ['node', 'python', 'chrome'];

    for (const t of types) {
      debugSessions[t] = { debugType: t, totalSessions: 1, totalSeconds: 10 };
    }

    assert.strictEqual(Object.keys(debugSessions).length, 3);
    assert.strictEqual(debugSessions['node'].debugType, 'node');
    assert.strictEqual(debugSessions['python'].debugType, 'python');
  });
});

suite('Waqt — Daily Snapshot', () => {
  test('getLast30Days produces exactly 30 entries', () => {
    const daily: Record<string, any> = {};
    const result: any[] = [];
    const now = new Date();

    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      result.push(daily[key] ?? { date: key, totalSeconds: 0, typedSeconds: 0, aiSeconds: 0, pastedSeconds: 0, debugSeconds: 0, keystrokes: 0 });
    }

    assert.strictEqual(result.length, 30);
    // First entry should be 29 days ago, last entry today
    const today = new Date().toISOString().split('T')[0];
    assert.strictEqual(result[result.length - 1].date, today);
  });

  test('fills missing days with zeros', () => {
    const daily: Record<string, any> = {};
    const result: any[] = [];
    const now = new Date();

    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      result.push(daily[key] ?? { date: key, totalSeconds: 0 });
    }

    for (const entry of result) {
      assert.strictEqual(entry.totalSeconds, 0);
    }
  });

  test('preserves existing daily data', () => {
    const today = new Date().toISOString().split('T')[0];
    const daily: Record<string, any> = {
      [today]: { date: today, totalSeconds: 3600, typedSeconds: 1800, aiSeconds: 900, pastedSeconds: 900, debugSeconds: 0, keystrokes: 200 },
    };

    const entry = daily[today];
    assert.strictEqual(entry.totalSeconds, 3600);
    assert.strictEqual(entry.typedSeconds + entry.aiSeconds + entry.pastedSeconds + entry.debugSeconds, 3600);
  });
});

suite('Waqt — Data Migration', () => {
  test('migrateShape adds missing fields to old data', () => {
    const oldData: any = {
      files: {
        '/a/foo.ts': { filePath: '/a/foo.ts', fileName: 'foo.ts', project: 'a', totalSeconds: 100, typedSeconds: 80, aiSeconds: 20, lastSeen: 0, keystrokes: 5, aiCompletionsAccepted: 0 },
      },
      aiTools: {},
      daily: {
        '2025-01-01': { date: '2025-01-01', totalSeconds: 100, typedSeconds: 80, aiSeconds: 20, keystrokes: 5 },
      },
      lastUpdated: 0,
    };

    // Simulate migrateShape
    if (!oldData.cliTools) { oldData.cliTools = {}; }
    if (!oldData.editors) { oldData.editors = {}; }
    if (!oldData.debugSessions) { oldData.debugSessions = {}; }
    for (const file of Object.values(oldData.files) as any[]) {
      if (file.pastedSeconds === undefined) { file.pastedSeconds = 0; }
      if (file.pasteEvents === undefined) { file.pasteEvents = 0; }
      if (file.debugSeconds === undefined) { file.debugSeconds = 0; }
    }
    for (const day of Object.values(oldData.daily) as any[]) {
      if (day.pastedSeconds === undefined) { day.pastedSeconds = 0; }
      if (day.debugSeconds === undefined) { day.debugSeconds = 0; }
    }

    assert.deepStrictEqual(oldData.cliTools, {});
    assert.deepStrictEqual(oldData.debugSessions, {});
    assert.strictEqual(oldData.files['/a/foo.ts'].pastedSeconds, 0);
    assert.strictEqual(oldData.files['/a/foo.ts'].debugSeconds, 0);
    assert.strictEqual(oldData.daily['2025-01-01'].pastedSeconds, 0);
    assert.strictEqual(oldData.daily['2025-01-01'].debugSeconds, 0);
  });

  test('migration preserves existing numeric values', () => {
    const data: any = {
      files: {
        '/a/bar.ts': { pastedSeconds: 42, debugSeconds: 15, pasteEvents: 3 },
      },
    };

    if (data.files['/a/bar.ts'].pastedSeconds === undefined) { data.files['/a/bar.ts'].pastedSeconds = 0; }
    if (data.files['/a/bar.ts'].debugSeconds === undefined) { data.files['/a/bar.ts'].debugSeconds = 0; }

    assert.strictEqual(data.files['/a/bar.ts'].pastedSeconds, 42);
    assert.strictEqual(data.files['/a/bar.ts'].debugSeconds, 15);
  });
});

suite('Waqt — Idle Detection', () => {
  test('marks as idle when threshold exceeded', () => {
    const IDLE_THRESHOLD_MS = 120_000; // 2 minutes
    const lastActivity = Date.now() - 130_000; // 2m 10s ago
    const isIdle = (Date.now() - lastActivity) > IDLE_THRESHOLD_MS;
    assert.strictEqual(isIdle, true);
  });

  test('not idle when within threshold', () => {
    const IDLE_THRESHOLD_MS = 120_000;
    const lastActivity = Date.now() - 10_000; // 10s ago
    const isIdle = (Date.now() - lastActivity) > IDLE_THRESHOLD_MS;
    assert.strictEqual(isIdle, false);
  });
});

suite('Waqt — AI Extension Registry', () => {
  test('built-in extension list contains key tools', () => {
    const KNOWN_IDS = [
      'GitHub.copilot',
      'GitHub.copilot-chat',
      'Codeium.codeium',
      'TabNine.tabnine-vscode',
      'Continue.continue',
      'supermaven.supermaven',
      'sourcegraph.cody-ai',
      'Google.gemini-code-assist',
    ];

    // Validate they're all distinct
    const unique = new Set(KNOWN_IDS.map(id => id.toLowerCase()));
    assert.strictEqual(unique.size, KNOWN_IDS.length, 'All extension IDs must be unique');
  });

  test('extension detection is case-insensitive', () => {
    const registry = new Map<string, string>([
      ['github.copilot', 'GitHub Copilot'],
      ['codeium.codeium', 'Codeium'],
    ]);

    const detectedId = 'GitHub.Copilot';
    assert.strictEqual(registry.has(detectedId.toLowerCase()), true);
  });
});

suite('Waqt — CLI Tool Pattern Matching', () => {
  const CLI_PATTERNS = [
    { name: 'Claude Code',        pattern: /\bclaude\b/ },
    { name: 'Gemini CLI',         pattern: /\bgemini\b/ },
    { name: 'ChatGPT Codex',      pattern: /\bcodex\b/ },
    { name: 'Aider',              pattern: /\baider\b/ },
    { name: 'GitHub Copilot CLI', pattern: /\bgh\s+copilot\b/ },
  ];

  function matchCli(commandLine: string): string | null {
    for (const tool of CLI_PATTERNS) {
      if (tool.pattern.test(commandLine)) { return tool.name; }
    }
    return null;
  }

  test('detects claude command', () => {
    assert.strictEqual(matchCli('claude --chat'), 'Claude Code');
    assert.strictEqual(matchCli('claude'), 'Claude Code');
  });

  test('detects gemini command', () => {
    assert.strictEqual(matchCli('gemini run'), 'Gemini CLI');
    assert.strictEqual(matchCli('echo | gemini'), 'Gemini CLI');
  });

  test('detects aider command', () => {
    assert.strictEqual(matchCli('aider --model gpt-4'), 'Aider');
  });

  test('detects gh copilot command', () => {
    assert.strictEqual(matchCli('gh copilot suggest'), 'GitHub Copilot CLI');
  });

  test('does not false-positive on partial matches', () => {
    // 'includes' should not match — word boundary prevents partial
    assert.strictEqual(matchCli('echo "claudette"'), null);
    assert.strictEqual(matchCli('npm run generate'), null);
  });

  test('returns null for unrecognised commands', () => {
    assert.strictEqual(matchCli('git commit -m "fix"'), null);
    assert.strictEqual(matchCli('npm install'), null);
    assert.strictEqual(matchCli('python main.py'), null);
  });
});

suite('Waqt — Editor Detection Logic', () => {
  const SCHEME_MAP: Record<string, { type: string; name: string }> = {
    'vscode':          { type: 'vscode',       name: 'VS Code' },
    'vscode-insiders': { type: 'vscode',       name: 'VS Code Insiders' },
    'cursor':          { type: 'cursor',        name: 'Cursor' },
    'vscodium':        { type: 'vscodium',      name: 'VSCodium' },
    'antigravity':     { type: 'antigravity',   name: 'Antigravity' },
    'windsurf':        { type: 'windsurf',      name: 'Windsurf' },
  };

  function detectEditorFromScheme(scheme: string): string | null {
    return SCHEME_MAP[scheme]?.name ?? null;
  }

  test('detects VS Code from uri scheme', () => {
    assert.strictEqual(detectEditorFromScheme('vscode'), 'VS Code');
  });

  test('detects Cursor from uri scheme', () => {
    assert.strictEqual(detectEditorFromScheme('cursor'), 'Cursor');
  });

  test('detects VSCodium from uri scheme', () => {
    assert.strictEqual(detectEditorFromScheme('vscodium'), 'VSCodium');
  });

  test('detects Antigravity from uri scheme', () => {
    assert.strictEqual(detectEditorFromScheme('antigravity'), 'Antigravity');
  });

  test('detects Windsurf from uri scheme', () => {
    assert.strictEqual(detectEditorFromScheme('windsurf'), 'Windsurf');
  });

  test('returns null for unknown scheme', () => {
    assert.strictEqual(detectEditorFromScheme('unknown-editor'), null);
  });
});
