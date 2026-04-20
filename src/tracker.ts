import * as vscode from 'vscode';
import { EditorInfo } from './editorDetector';

// ─── Interfaces ─────────────────────────────────────────────────────────────

export interface FileStats {
  filePath: string;
  fileName: string;
  project: string;
  totalSeconds: number;
  typedSeconds: number;     // time user was actively typing
  aiSeconds: number;        // time AI tool was active
  pastedSeconds: number;    // time attributed to paste / big-change from external source
  debugSeconds: number;     // time spent debugging
  lastSeen: number;
  keystrokes: number;
  aiCompletionsAccepted: number;
  pasteEvents: number;      // count of detected paste/big-change events
}

export interface ProjectStats {
  name: string;
  totalSeconds: number;
  typedSeconds: number;
  aiSeconds: number;
  pastedSeconds: number;
  debugSeconds: number;
  files: string[];
  keystrokes: number;
}

export interface AiToolStats {
  extensionId: string;
  displayName: string;
  activeSeconds: number;
  completionsAccepted: number;
}

export interface CliToolStats {
  toolName: string;
  totalSessions: number;
  totalSeconds: number;
}

export interface DebugSessionStats {
  debugType: string;        // e.g. 'node', 'python', 'chrome', etc.
  totalSessions: number;
  totalSeconds: number;
}

export interface DailySnapshot {
  date: string; // YYYY-MM-DD
  totalSeconds: number;
  typedSeconds: number;
  aiSeconds: number;
  pastedSeconds: number;
  debugSeconds: number;
  keystrokes: number;
}

export interface EditorStats {
  editorName: string;
  editorType: string;
  totalSeconds: number;
}

export interface StoredData {
  files: Record<string, FileStats>;
  aiTools: Record<string, AiToolStats>;
  cliTools: Record<string, CliToolStats>;
  debugSessions: Record<string, DebugSessionStats>;
  daily: Record<string, DailySnapshot>;
  editors: Record<string, EditorStats>;
  lastUpdated: number;
}

// ─── Change classification ──────────────────────────────────────────────────

export enum ChangeSource {
  Typed = 'typed',
  AiAssisted = 'ai',
  Pasted = 'pasted',
}

// ─── Tracker ────────────────────────────────────────────────────────────────

export class TimeTracker {
  private data: StoredData;
  private context: vscode.ExtensionContext;
  private activeFile: string | null = null;
  private sessionStart: number = 0;
  private lastActivityTime: number = Date.now();
  private isIdle: boolean = false;
  private isAiExtensionInstalled: boolean = false; // any AI extension detected (permanent)
  private isAiActive: boolean = false;              // AI completion accepted recently (decays)
  private aiDecayTimeout: NodeJS.Timeout | null = null;
  private isCliActive: boolean = false;
  private activeCliTool: string | null = null;
  private tickInterval: NodeJS.Timeout | null = null;
  private idleCheckInterval: NodeJS.Timeout | null = null;
  private statusBarItem: vscode.StatusBarItem;
  private editorInfo: EditorInfo | null = null;
  private lastClipboardContent: string = '';
  private isPastedRecently: boolean = false;
  private pasteDecayTimeout: NodeJS.Timeout | null = null;
  private isDebugging: boolean = false;
  private activeDebugType: string | null = null;
  private debugSessionStart: number = 0;
  private activeAiExtensionId: string | null = null;
  private readonly PASTE_DECAY_MS = 10000; // attribute paste/AI time for 10s after event

  private readonly STORAGE_KEY = 'waqt.data';
  private readonly TICK_MS = 5000;       // update every 5s
  private readonly IDLE_CHECK_MS = 15000;
  private readonly PASTE_THRESHOLD = 100; // chars to classify as paste/big-change

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.data = this.load();
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.statusBarItem.command = 'waqt.showDashboard';
    this.statusBarItem.show();
    context.subscriptions.push(this.statusBarItem);
  }

  // ─── Storage ────────────────────────────────────────────────────────────

  private load(): StoredData {
    let stored = this.context.globalState.get<StoredData>(this.STORAGE_KEY);
    if (stored) {
      return this.migrateShape(stored);
    }
    return this.emptyData();
  }

  private emptyData(): StoredData {
    return {
      files: {},
      aiTools: {},
      cliTools: {},
      debugSessions: {},
      daily: {},
      editors: {},
      lastUpdated: Date.now(),
    };
  }

  /**
   * Ensure existing stored data has all new fields.
   */
  private migrateShape(data: StoredData): StoredData {
    // Ensure new top-level fields exist
    if (!data.cliTools) { data.cliTools = {}; }
    if (!data.editors) { data.editors = {}; }
    if (!data.debugSessions) { data.debugSessions = {}; }

    // Ensure new per-file fields
    for (const file of Object.values(data.files)) {
      if (file.pastedSeconds === undefined) { file.pastedSeconds = 0; }
      if (file.pasteEvents === undefined) { file.pasteEvents = 0; }
      if (file.debugSeconds === undefined) { file.debugSeconds = 0; }
    }

    // Ensure new daily fields
    for (const day of Object.values(data.daily)) {
      if (day.pastedSeconds === undefined) { day.pastedSeconds = 0; }
      if (day.debugSeconds === undefined) { day.debugSeconds = 0; }
    }

    return data;
  }

  async save(): Promise<void> {
    this.data.lastUpdated = Date.now();
    await this.context.globalState.update(this.STORAGE_KEY, this.data);
  }

  async reset(): Promise<void> {
    this.data = this.emptyData();
    // Reset transient state
    this.isPastedRecently = false;
    this.isAiActive = false;
    if (this.pasteDecayTimeout) { clearTimeout(this.pasteDecayTimeout); this.pasteDecayTimeout = null; }
    if (this.aiDecayTimeout) { clearTimeout(this.aiDecayTimeout); this.aiDecayTimeout = null; }
    await this.save();
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  start(): void {
    this.tickInterval = setInterval(() => this.tick(), this.TICK_MS);
    this.idleCheckInterval = setInterval(() => this.checkIdle(), this.IDLE_CHECK_MS);
    this.updateStatusBar();

    // Periodically snapshot clipboard for paste detection
    this.pollClipboard();
  }

  async stop(): Promise<void> {
    if (this.tickInterval) { clearInterval(this.tickInterval); }
    if (this.idleCheckInterval) { clearInterval(this.idleCheckInterval); }
    if (this.pasteDecayTimeout) { clearTimeout(this.pasteDecayTimeout); this.pasteDecayTimeout = null; }
    if (this.aiDecayTimeout) { clearTimeout(this.aiDecayTimeout); this.aiDecayTimeout = null; }
    await this.save();
  }

  setEditorInfo(info: EditorInfo): void {
    this.editorInfo = info;

    // Track editor usage
    if (!this.data.editors[info.type]) {
      this.data.editors[info.type] = {
        editorName: info.name,
        editorType: info.type,
        totalSeconds: 0,
      };
    }
  }

  // ─── Event handlers ─────────────────────────────────────────────────────

  onDidChangeActiveEditor(editor: vscode.TextEditor | undefined): void {
    this.activeFile = editor?.document.uri.fsPath ?? null;
    this.sessionStart = Date.now();
    this.markActivity();
  }

  /**
   * Handles document changes with 3-way classification:
   *  1. AI-assisted: large insertion while AI extension/CLI is active
   *  2. Pasted: large insertion with NO AI context (likely clipboard paste from chatbot/web)
   *  3. Typed: small changes from the user
   */
  onDidChangeTextDocument(event: vscode.TextDocumentChangeEvent): void {
    if (event.contentChanges.length === 0) { return; }
    const filePath = event.document.uri.fsPath;
    const stats = this.ensureFile(filePath);

    const totalInserted = event.contentChanges.reduce((sum, c) => sum + c.text.length, 0);

    if (totalInserted > this.PASTE_THRESHOLD) {
      // Large insertion detected
      if (this.isAiExtensionInstalled || this.isCliActive) {
        // AI extension installed or CLI active → attribute to AI completion
        stats.aiCompletionsAccepted++;
        this.markAiUsage(filePath);
      } else {
        // No AI tool present → likely pasted from chatbot/external source
        stats.pasteEvents++;
        this.markPasteUsage(filePath);
      }
    } else if (totalInserted > 50 && this.isAiExtensionInstalled) {
      // Medium insertion while AI extension is installed → also AI
      stats.aiCompletionsAccepted++;
      this.markAiUsage(filePath);
    } else {
      // Normal typing
      stats.keystrokes += event.contentChanges.length;
      this.markActivity();
    }
  }

  onAiExtensionDetected(extensionId: string, displayName: string): void {
    this.isAiExtensionInstalled = true;
    this.activeAiExtensionId = extensionId;
    if (!this.data.aiTools[extensionId]) {
      this.data.aiTools[extensionId] = {
        extensionId,
        displayName,
        activeSeconds: 0,
        completionsAccepted: 0,
      };
    }
  }

  onCliToolStarted(toolName: string): void {
    this.isCliActive = true;
    this.activeCliTool = toolName;
    if (!this.data.cliTools[toolName]) {
      this.data.cliTools[toolName] = {
        toolName,
        totalSessions: 0,
        totalSeconds: 0,
      };
    }
    this.data.cliTools[toolName].totalSessions++;
  }

  onCliToolEnded(toolName: string, durationSeconds: number): void {
    this.isCliActive = false;
    this.activeCliTool = null;
    if (this.data.cliTools[toolName]) {
      this.data.cliTools[toolName].totalSeconds += durationSeconds;
    }
    this.save();
  }

  onDebugSessionStarted(session: vscode.DebugSession): void {
    this.isDebugging = true;
    this.activeDebugType = session.type;
    this.debugSessionStart = Date.now();
    const key = session.type;
    if (!this.data.debugSessions[key]) {
      this.data.debugSessions[key] = {
        debugType: session.type,
        totalSessions: 0,
        totalSeconds: 0,
      };
    }
    this.data.debugSessions[key].totalSessions++;
  }

  onDebugSessionEnded(session: vscode.DebugSession): void {
    if (!this.isDebugging) { return; }
    const durationSec = (Date.now() - this.debugSessionStart) / 1000;
    const key = session.type;
    if (this.data.debugSessions[key]) {
      this.data.debugSessions[key].totalSeconds += durationSec;
    }
    this.isDebugging = false;
    this.activeDebugType = null;
    this.debugSessionStart = 0;
    this.save();
  }

  // ─── Activity tracking ─────────────────────────────────────────────────

  private markActivity(): void {
    this.lastActivityTime = Date.now();
    this.isIdle = false;
  }

  private markAiUsage(_filePath: string): void {
    this.lastActivityTime = Date.now();
    this.isIdle = false;
    this.isAiActive = true;

    if (this.aiDecayTimeout) { clearTimeout(this.aiDecayTimeout); }
    this.aiDecayTimeout = setTimeout(() => {
      this.isAiActive = false;
      this.aiDecayTimeout = null;
    }, this.PASTE_DECAY_MS);
  }

  private markPasteUsage(_filePath: string): void {
    this.lastActivityTime = Date.now();
    this.isIdle = false;
    this.isPastedRecently = true;

    // Clear any previous decay timer
    if (this.pasteDecayTimeout) {
      clearTimeout(this.pasteDecayTimeout);
    }

    // After PASTE_DECAY_MS, stop attributing time to paste
    this.pasteDecayTimeout = setTimeout(() => {
      this.isPastedRecently = false;
      this.pasteDecayTimeout = null;
    }, this.PASTE_DECAY_MS);
  }

  private checkIdle(): void {
    const config = vscode.workspace.getConfiguration('waqt');
    const idleThreshold = config.get<number>('idleThresholdSeconds', 120) * 1000;
    const now = Date.now();
    this.isIdle = (now - this.lastActivityTime) > idleThreshold;
  }

  /**
   * Polls clipboard content to help distinguish AI completions from manual paste.
   */
  private async pollClipboard(): Promise<void> {
    try {
      this.lastClipboardContent = await vscode.env.clipboard.readText();
    } catch {
      // Clipboard access may be restricted in some environments
    }
  }

  // ─── Tick ───────────────────────────────────────────────────────────────

  private tick(): void {
    if (this.isIdle || !this.activeFile) {
      this.updateStatusBar();
      return;
    }

    const tickSec = this.TICK_MS / 1000;
    const today = this.todayKey();
    const daily = this.ensureDaily(today);
    const fileStats = this.ensureFile(this.activeFile);

    // Update file stats
    fileStats.totalSeconds += tickSec;
    fileStats.lastSeen = Date.now();
    daily.totalSeconds += tickSec;

    if (this.isDebugging) {
      // Debugging session active
      fileStats.debugSeconds += tickSec;
      daily.debugSeconds += tickSec;
    } else if (this.isPastedRecently) {
      // Recently pasted content — attribute to pasted/external
      fileStats.pastedSeconds += tickSec;
      daily.pastedSeconds += tickSec;
    } else if (this.isCliActive) {
      // CLI tool session active — credit to AI
      fileStats.aiSeconds += tickSec;
      daily.aiSeconds += tickSec;
    } else if (this.isAiActive) {
      fileStats.aiSeconds += tickSec;
      daily.aiSeconds += tickSec;

      // Credit active AI extension
      const activeAiId = this.getActiveAiTool();
      if (activeAiId && this.data.aiTools[activeAiId]) {
        this.data.aiTools[activeAiId].activeSeconds += tickSec;
      }
    } else {
      fileStats.typedSeconds += tickSec;
      daily.typedSeconds += tickSec;
    }

    // Track editor usage
    if (this.editorInfo && this.data.editors[this.editorInfo.type]) {
      this.data.editors[this.editorInfo.type].totalSeconds += tickSec;
    }

    this.updateStatusBar();
    this.save();
  }

  private getActiveAiTool(): string | null {
    return this.activeAiExtensionId;
  }

  // ─── Data helpers ───────────────────────────────────────────────────────

  private ensureFile(filePath: string): FileStats {
    if (!this.data.files[filePath]) {
      const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
      const project = this.getProject(filePath);
      this.data.files[filePath] = {
        filePath, fileName, project,
        totalSeconds: 0, typedSeconds: 0, aiSeconds: 0,
        pastedSeconds: 0, debugSeconds: 0,
        lastSeen: Date.now(), keystrokes: 0, aiCompletionsAccepted: 0,
        pasteEvents: 0,
      };
    }
    return this.data.files[filePath];
  }

  private ensureDaily(dateKey: string): DailySnapshot {
    if (!this.data.daily[dateKey]) {
      this.data.daily[dateKey] = {
        date: dateKey, totalSeconds: 0, typedSeconds: 0, aiSeconds: 0,
        pastedSeconds: 0, debugSeconds: 0, keystrokes: 0,
      };
    }
    return this.data.daily[dateKey];
  }

  private getProject(filePath: string): string {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) { return 'Unknown'; }
    for (const folder of folders) {
      if (filePath.startsWith(folder.uri.fsPath)) {
        return folder.name;
      }
    }
    return 'Unknown';
  }

  private todayKey(): string {
    return new Date().toISOString().split('T')[0];
  }

  private updateStatusBar(): void {
    const today = this.data.daily[this.todayKey()];
    const totalSec = today?.totalSeconds ?? 0;
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const timeStr = h > 0 ? `${h}h ${m}m` : `${m}m`;
    const icon = this.isIdle ? '$(clock)' : '$(pulse)';
    const editorLabel = this.editorInfo ? ` · ${this.editorInfo.name}` : '';
    this.statusBarItem.text = `${icon} ${timeStr} today`;
    this.statusBarItem.tooltip = `Waqt — Click to open dashboard${editorLabel}`;
  }

  // ─── Public getters ─────────────────────────────────────────────────────

  getData(): StoredData {
    return this.data;
  }

  getEditorInfo(): EditorInfo | null {
    return this.editorInfo;
  }

  getProjectStats(): ProjectStats[] {
    const projects: Record<string, ProjectStats> = {};
    for (const [path, file] of Object.entries(this.data.files)) {
      const p = file.project;
      if (!projects[p]) {
        projects[p] = {
          name: p, totalSeconds: 0, typedSeconds: 0, aiSeconds: 0,
          pastedSeconds: 0, debugSeconds: 0, files: [], keystrokes: 0,
        };
      }
      projects[p].totalSeconds += file.totalSeconds;
      projects[p].typedSeconds += file.typedSeconds;
      projects[p].aiSeconds += file.aiSeconds;
      projects[p].pastedSeconds += file.pastedSeconds;
      projects[p].debugSeconds += file.debugSeconds;
      projects[p].keystrokes += file.keystrokes;
      if (!projects[p].files.includes(path)) { projects[p].files.push(path); }
    }
    return Object.values(projects).sort((a, b) => b.totalSeconds - a.totalSeconds);
  }

  getLast30Days(): DailySnapshot[] {
    const result: DailySnapshot[] = [];
    const now = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      result.push(this.data.daily[key] ?? {
        date: key, totalSeconds: 0, typedSeconds: 0, aiSeconds: 0,
        pastedSeconds: 0, debugSeconds: 0, keystrokes: 0,
      });
    }
    return result;
  }

  getDebugStats(): DebugSessionStats[] {
    return Object.values(this.data.debugSessions)
      .sort((a, b) => b.totalSeconds - a.totalSeconds);
  }

  isCurrentlyDebugging(): boolean {
    return this.isDebugging;
  }
}
