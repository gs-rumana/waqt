import * as vscode from 'vscode';

export enum EditorType {
  VSCode = 'vscode',
  Cursor = 'cursor',
  VSCodium = 'vscodium',
  Antigravity = 'antigravity',
  Windsurf = 'windsurf',
  Positron = 'positron',
  Unknown = 'unknown',
}

export interface EditorInfo {
  name: string;        // Human-readable: "VS Code", "Cursor", etc.
  type: EditorType;
  version: string;
  uriScheme: string;
}

// Map URI schemes to editor types
const SCHEME_MAP: Record<string, { type: EditorType; name: string }> = {
  'vscode':        { type: EditorType.VSCode,       name: 'VS Code' },
  'vscode-insiders': { type: EditorType.VSCode,     name: 'VS Code Insiders' },
  'cursor':        { type: EditorType.Cursor,        name: 'Cursor' },
  'vscodium':      { type: EditorType.VSCodium,      name: 'VSCodium' },
  'antigravity':   { type: EditorType.Antigravity,   name: 'Antigravity' },
  'windsurf':      { type: EditorType.Windsurf,      name: 'Windsurf' },
  'positron':      { type: EditorType.Positron,       name: 'Positron' },
};

// Fallback: match appName substrings
const APP_NAME_PATTERNS: Array<{ pattern: RegExp; type: EditorType; name: string }> = [
  { pattern: /cursor/i,        type: EditorType.Cursor,      name: 'Cursor' },
  { pattern: /vscodium/i,      type: EditorType.VSCodium,    name: 'VSCodium' },
  { pattern: /antigravity/i,   type: EditorType.Antigravity, name: 'Antigravity' },
  { pattern: /windsurf/i,      type: EditorType.Windsurf,    name: 'Windsurf' },
  { pattern: /positron/i,      type: EditorType.Positron,    name: 'Positron' },
];

// Fallback: environment variables set by specific editors
const ENV_CHECKS: Array<{ envKey: string; type: EditorType; name: string }> = [
  { envKey: 'CURSOR_VERSION',    type: EditorType.Cursor,    name: 'Cursor' },
  { envKey: 'WINDSURF_VERSION',  type: EditorType.Windsurf,  name: 'Windsurf' },
  { envKey: 'POSITRON_VERSION',  type: EditorType.Positron,  name: 'Positron' },
];

/**
 * Detects the current editor type using multiple strategies:
 * 1. URI scheme (most reliable)
 * 2. App name matching
 * 3. Environment variable checks
 */
export function detectEditor(): EditorInfo {
  const uriScheme = vscode.env.uriScheme;
  const appName = vscode.env.appName;
  const version = vscode.version;

  // Strategy 1: URI scheme lookup
  const schemeMatch = SCHEME_MAP[uriScheme];
  if (schemeMatch) {
    return {
      name: schemeMatch.name,
      type: schemeMatch.type,
      version,
      uriScheme,
    };
  }

  // Strategy 2: App name pattern matching
  for (const entry of APP_NAME_PATTERNS) {
    if (entry.pattern.test(appName)) {
      return {
        name: entry.name,
        type: entry.type,
        version,
        uriScheme,
      };
    }
  }

  // Strategy 3: Environment variables
  for (const entry of ENV_CHECKS) {
    if (process.env[entry.envKey]) {
      return {
        name: entry.name,
        type: entry.type,
        version,
        uriScheme,
      };
    }
  }

  // Fallback: assume VS Code or unknown
  if (appName.includes('Visual Studio Code')) {
    return { name: 'VS Code', type: EditorType.VSCode, version, uriScheme };
  }

  return {
    name: appName || 'Unknown Editor',
    type: EditorType.Unknown,
    version,
    uriScheme,
  };
}
