import * as vscode from 'vscode';
import { TimeTracker } from './tracker';
import { AiDetector } from './aiDetector';
import { detectEditor } from './editorDetector';
import { getDashboardHtml } from './dashboard';

let tracker: TimeTracker;
let aiDetector: AiDetector;
let dashboardPanel: vscode.WebviewPanel | undefined;

export async function activate(context: vscode.ExtensionContext) {
  // Detect editor type
  const editorInfo = detectEditor();

  // Initialize tracker
  tracker = new TimeTracker(context);
  tracker.setEditorInfo(editorInfo);
  tracker.start();

  // Initialize AI detector with callbacks
  aiDetector = new AiDetector(context, {
    onExtensionDetected: (extensionId, displayName) => {
      tracker.onAiExtensionDetected(extensionId, displayName);
    },
    onCliStarted: (toolName) => {
      tracker.onCliToolStarted(toolName);
    },
    onCliEnded: (toolName, durationSeconds) => {
      tracker.onCliToolEnded(toolName, durationSeconds);
    },
  });
  await aiDetector.start();
  context.subscriptions.push(aiDetector);

  // Watch for editor changes
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(editor => {
      tracker.onDidChangeActiveEditor(editor);
    }),
    vscode.workspace.onDidChangeTextDocument(event => {
      tracker.onDidChangeTextDocument(event);
    }),
    // Debug session tracking
    vscode.debug.onDidStartDebugSession(session => {
      tracker.onDebugSessionStarted(session);
    }),
    vscode.debug.onDidTerminateDebugSession(session => {
      tracker.onDebugSessionEnded(session);
    })
  );

  // Initialize with current editor
  if (vscode.window.activeTextEditor) {
    tracker.onDidChangeActiveEditor(vscode.window.activeTextEditor);
  }

  // Commands (rebranded to waqt.*)
  context.subscriptions.push(
    vscode.commands.registerCommand('waqt.showDashboard', () => {
      showDashboard(context);
    }),
    vscode.commands.registerCommand('waqt.resetStats', async () => {
      const confirm = await vscode.window.showWarningMessage(
        'Reset all Waqt statistics? This cannot be undone.',
        { modal: true },
        'Reset'
      );
      if (confirm === 'Reset') {
        await tracker.reset();
        vscode.window.showInformationMessage('Waqt stats reset.');
        if (dashboardPanel) { refreshDashboard(); }
      }
    })
  );
}

function showDashboard(context: vscode.ExtensionContext) {
  if (dashboardPanel) {
    dashboardPanel.reveal(vscode.ViewColumn.One);
    refreshDashboard();
    return;
  }

  dashboardPanel = vscode.window.createWebviewPanel(
    'waqtDashboard',
    'Waqt Dashboard',
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [],
    }
  );

  refreshDashboard();

  dashboardPanel.webview.onDidReceiveMessage(async message => {
    if (message.command === 'refresh') {
      refreshDashboard();
    } else if (message.command === 'reset') {
      await tracker.reset();
      vscode.window.showInformationMessage('Waqt stats reset.');
      refreshDashboard();
    }
  });

  dashboardPanel.onDidDispose(() => {
    dashboardPanel = undefined;
  }, null, context.subscriptions);

  // Auto-refresh every 30s while open
  const refreshInterval = setInterval(() => {
    if (dashboardPanel) { refreshDashboard(); }
    else { clearInterval(refreshInterval); }
  }, 30000);
}

function refreshDashboard() {
  if (!dashboardPanel) { return; }
  const data = tracker.getData();
  const projects = tracker.getProjectStats();
  const last30 = tracker.getLast30Days();
  const editorInfo = tracker.getEditorInfo();
  const debugStats = tracker.getDebugStats();
  const topFiles = Object.values(data.files)
    .sort((a, b) => b.totalSeconds - a.totalSeconds);

  dashboardPanel.webview.html = getDashboardHtml(data, projects, last30, topFiles, editorInfo, debugStats);
}

export async function deactivate() {
  await tracker?.stop();
}
