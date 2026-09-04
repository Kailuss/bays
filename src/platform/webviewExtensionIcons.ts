import * as vscode from 'vscode';
import { Logger } from './logger';

/**
 * Icons for editor tabs that are webviews owned by OTHER extensions
 * (Claude Code, etc.).
 *
 * VS Code's `vscode.Tab` API exposes neither the tab's `iconPath` nor the id of
 * the extension that owns the webview, so the real "native" tab icon can't be
 * read back. What we CAN do is ship a tiny registry that maps a stable viewType
 * substring to an icon RESOURCE inside the installed extension, load it once at
 * activation, and render the actual brand logo instead of a generic codicon.
 *
 * The logo is inlined as a base64 `<img>` (data URI) so it reuses the existing
 * `.bay-icon img` sizing and the webview CSP already allows `img-src data:`.
 */

interface WebviewIconSource {
  /** Case-insensitive substring matched against the tab's viewType. */
  match        : string;
  extensionId  : string;
  /** Icon resource relative to the extension root. Prefer a small SVG. */
  resourcePath : string;
}

// Claude Code's editor tabs report viewType `mainThreadWebview-claudeVSCodePanel`
// / `-claudePlanPreview`; both contain "claude". The extension ships a compact
// brand SVG we can inline.
const SOURCES: WebviewIconSource[] = [
  { match: 'claude', extensionId: 'anthropic.claude-code', resourcePath: 'resources/claude-logo.svg' },
];

// viewType-substring → ready-to-inline <img> html. Filled by preload, read sync.
const cache = new Map<string, string>();

/**
 * Loads every registered extension icon into the cache. Safe to call more than
 * once (e.g. after an extension is installed/enabled mid-session). Failures are
 * logged and skipped — the icon simply falls back to its codicon.
 */
export async function preloadWebviewExtensionIcons(): Promise<void> {
  for (const src of SOURCES) {
    try {
      const ext = vscode.extensions.getExtension(src.extensionId);
      if (!ext) { continue; }

      const uri   = vscode.Uri.joinPath(ext.extensionUri, ...src.resourcePath.split('/'));
      const bytes = await vscode.workspace.fs.readFile(uri);
      const b64   = Buffer.from(bytes).toString('base64');
      const mime  = src.resourcePath.endsWith('.svg') ? 'image/svg+xml' : 'image/png';

      cache.set(src.match.toLowerCase(), `<img src="data:${mime};base64,${b64}" alt="" />`);
      Logger.log(`[WebviewIcons] Loaded icon for ${src.extensionId}`);
    } catch (err) {
      Logger.warn(`[WebviewIcons] Could not load icon for ${src.extensionId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/**
 * Returns inline `<img>` html for a webview's owning-extension icon, or undefined
 * if none is registered/loaded for this viewType (caller falls back to a codicon).
 */
export function resolveWebviewExtensionIcon(viewType?: string): string | undefined {
  if (!viewType) { return undefined; }
  const lower = viewType.toLowerCase();
  for (const [needle, html] of cache) {
    if (lower.includes(needle)) { return html; }
  }
  return undefined;
}
