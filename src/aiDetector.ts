import * as vscode from 'vscode';

// ─── Known AI Extensions ────────────────────────────────────────────────────

export interface AiExtensionEntry {
  id: string;
  displayName: string;
}

/** Built-in registry of known AI coding extensions. */
export const KNOWN_AI_EXTENSIONS: AiExtensionEntry[] = [
  { id: 'GitHub.copilot',                      displayName: 'GitHub Copilot' },
  { id: 'GitHub.copilot-chat',                  displayName: 'GitHub Copilot Chat' },
  { id: 'Codeium.codeium',                      displayName: 'Codeium' },
  { id: 'TabNine.tabnine-vscode',               displayName: 'Tabnine' },
  { id: 'Continue.continue',                    displayName: 'Continue' },
  { id: 'supermaven.supermaven',                 displayName: 'Supermaven' },
  { id: 'AmazonWebServices.aws-toolkit-vscode', displayName: 'Amazon Q' },
  { id: 'amazonwebservices.amazon-q-vscode',     displayName: 'Amazon Q (New)' },
  { id: 'sourcegraph.cody-ai',                   displayName: 'Sourcegraph Cody' },
  { id: 'Cursor.cursor',                         displayName: 'Cursor AI' },
  { id: 'saoudrizwan.claude-dev',                displayName: 'Claude Dev' },
  { id: 'anthropics.claude-code',                displayName: 'Claude Code (Extension)' },
  { id: 'Google.gemini-code-assist',             displayName: 'Gemini Code Assist' },
];

// ─── CLI Tool Patterns ──────────────────────────────────────────────────────

export interface CliToolPattern {
  name: string;
  pattern: RegExp;
}

/** CLI tool command patterns to detect in terminal. */
export const CLI_TOOL_PATTERNS: CliToolPattern[] = [
  { name: 'Claude Code',        pattern: /\bclaude\b/ },
  { name: 'Gemini CLI',         pattern: /\bgemini\b/ },
  { name: 'ChatGPT Codex',      pattern: /\bcodex\b/ },
  { name: 'Aider',              pattern: /\baider\b/ },
  { name: 'GitHub Copilot CLI', pattern: /\bgh\s+copilot\b/ },
  { name: 'OpenAI CLI',         pattern: /\bopenai\b/ },
];

// ─── CLI Session ────────────────────────────────────────────────────────────

export interface CliSession {
  toolName: string;
  startTime: number;
}

// ─── AI Detector Class ──────────────────────────────────────────────────────

export type AiExtensionCallback = (extensionId: string, displayName: string) => void;
export type CliSessionCallback = (toolName: string) => void;

export class AiDetector implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private activeSessions: Map<vscode.Terminal, CliSession> = new Map(); // terminal → session
  private scanInterval: NodeJS.Timeout | null = null;
  private detectedExtensions: Set<string> = new Set();
  private cliTrackingEnabled: boolean = false;

  private onExtensionDetected: AiExtensionCallback;
  private onCliStarted: CliSessionCallback;
  private onCliEnded: (toolName: string, durationSeconds: number) => void;

  constructor(
    private context: vscode.ExtensionContext,
    callbacks: {
      onExtensionDetected: AiExtensionCallback;
      onCliStarted: CliSessionCallback;
      onCliEnded: (toolName: string, durationSeconds: number) => void;
    }
  ) {
    this.onExtensionDetected = callbacks.onExtensionDetected;
    this.onCliStarted = callbacks.onCliStarted;
    this.onCliEnded = callbacks.onCliEnded;
  }

  /**
   * Start all detection: extensions scan + CLI monitoring (with consent).
   */
  async start(): Promise<void> {
    // Immediate extension scan
    this.scanExtensions();

    // Periodic re-scan every 60s (extensions can install mid-session)
    this.scanInterval = setInterval(() => this.scanExtensions(), 60_000);

    // CLI monitoring with consent check
    await this.initCliMonitoring();
  }

  // ─── Extension Detection ────────────────────────────────────────────────

  /**
   * Scans all installed extensions against known AI tools + user config.
   */
  private scanExtensions(): void {
    const config = vscode.workspace.getConfiguration('waqt');
    const customIds = config.get<string[]>('aiTools', []);

    // Merge built-in + user-configured
    const allIds = new Map<string, string>();
    for (const entry of KNOWN_AI_EXTENSIONS) {
      allIds.set(entry.id.toLowerCase(), entry.displayName);
    }
    for (const id of customIds) {
      allIds.set(id.toLowerCase(), id);
    }

    for (const ext of vscode.extensions.all) {
      const key = ext.id.toLowerCase();
      if (allIds.has(key) && !this.detectedExtensions.has(key)) {
        this.detectedExtensions.add(key);
        const displayName = ext.packageJSON?.displayName ?? allIds.get(key) ?? ext.id;
        this.onExtensionDetected(ext.id, displayName);
      }
    }
  }

  /**
   * Returns true if any known AI extension is currently installed/active.
   */
  isAnyAiExtensionActive(): boolean {
    return this.detectedExtensions.size > 0;
  }

  /**
   * Returns true if a CLI session is currently running.
   */
  hasActiveCliSession(): boolean {
    return this.activeSessions.size > 0;
  }

  /**
   * Returns the name of the currently active CLI tool, if any.
   */
  getActiveCliToolName(): string | null {
    // Return the most recent session
    for (const session of this.activeSessions.values()) {
      return session.toolName;
    }
    return null;
  }

  // ─── CLI Tool Monitoring ────────────────────────────────────────────────

  /**
   * Initializes CLI monitoring after checking user consent.
   */
  private async initCliMonitoring(): Promise<void> {
    const config = vscode.workspace.getConfiguration('waqt');
    const consent = config.get<string>('cliTrackingConsent', 'ask');

    if (consent === 'denied') {
      return; // User explicitly denied
    }

    if (consent === 'ask') {
      // Check if shell integration is even available before prompting
      const hasShellIntegration = typeof vscode.window.onDidStartTerminalShellExecution === 'function';
      if (!hasShellIntegration) {
        return; // API not available, skip silently
      }

      const answer = await vscode.window.showInformationMessage(
        'Waqt can detect terminal AI tools (Claude Code, Gemini CLI, etc.) to track AI-assisted coding time. Allow CLI tracking?',
        { modal: false },
        'Allow',
        'Deny',
        "Don't Ask Again"
      );

      if (answer === 'Allow') {
        await config.update('cliTrackingConsent', 'allowed', vscode.ConfigurationTarget.Global);
      } else if (answer === 'Deny') {
        await config.update('cliTrackingConsent', 'denied', vscode.ConfigurationTarget.Global);
        return;
      } else if (answer === "Don't Ask Again") {
        await config.update('cliTrackingConsent', 'denied', vscode.ConfigurationTarget.Global);
        return;
      } else {
        // Dismissed — ask again next time
        return;
      }
    }

    this.startCliListeners();
  }

  /**
   * Registers terminal shell execution listeners for CLI detection.
   */
  private startCliListeners(): void {
    this.cliTrackingEnabled = true;

    // Get user-configured extra patterns
    const config = vscode.workspace.getConfiguration('waqt');
    const customCliPatterns = config.get<Array<{ name: string; pattern: string }>>('cliTools', []);
    const extraPatterns: CliToolPattern[] = customCliPatterns.flatMap(p => {
      try {
        return [{ name: p.name, pattern: new RegExp(p.pattern) }];
      } catch {
        vscode.window.showWarningMessage(`Waqt: Invalid CLI pattern for "${p.name}" — skipping.`);
        return [];
      }
    });
    const allPatterns = [...CLI_TOOL_PATTERNS, ...extraPatterns];

    // Listen for terminal command execution start
    if (typeof vscode.window.onDidStartTerminalShellExecution === 'function') {
      this.disposables.push(
        vscode.window.onDidStartTerminalShellExecution(event => {
          const commandLine = event.execution?.commandLine?.value ?? '';

          for (const tool of allPatterns) {
            if (tool.pattern.test(commandLine)) {
              const session: CliSession = {
                toolName: tool.name,
                startTime: Date.now(),
              };
              this.activeSessions.set(event.terminal, session);
              this.onCliStarted(tool.name);
              break;
            }
          }
        })
      );

      // Listen for terminal command execution end
      this.disposables.push(
        vscode.window.onDidEndTerminalShellExecution(event => {
          const session = this.activeSessions.get(event.terminal);
          if (session) {
            const durationSec = (Date.now() - session.startTime) / 1000;
            this.activeSessions.delete(event.terminal);
            this.onCliEnded(session.toolName, durationSec);
          }
        })
      );
    }

    // Clean up sessions when terminals close
    this.disposables.push(
      vscode.window.onDidCloseTerminal(terminal => {
        const session = this.activeSessions.get(terminal);
        if (session) {
          const durationSec = (Date.now() - session.startTime) / 1000;
          this.activeSessions.delete(terminal);
          this.onCliEnded(session.toolName, durationSec);
        }
      })
    );
  }

  dispose(): void {
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
    }
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
