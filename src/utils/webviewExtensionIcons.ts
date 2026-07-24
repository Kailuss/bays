import * as vscode from 'vscode';
import { EXTENSION_PAGE_PREFIX } from './builtinIcons';
import { Logger } from './logger';

/**
 * Icons for editor tabs owned by OTHER extensions: webview panels (Claude Code,
 * GitLens…) and the built-in `Extension: <name>` detail page.
 *
 * VS Code's `vscode.Tab` API exposes neither the tab's `iconPath` nor the id of
 * the extension that owns the webview, so the real "native" tab icon can't be
 * read back through the API. But installed extensions are just folders on disk:
 * `vscode.extensions.all` gives their root (`extensionUri`) and parsed
 * `package.json`, whose `icon` field points at the marketplace logo. Matching a
 * tab to its owner runs in three tiers:
 *
 *  1. `Extension: <name>` labels — exact displayName match against the index.
 *  2. Declared custom editors — `contributes.customEditors[].viewType` maps a
 *     viewType to its owning extension exactly.
 *  3. Heuristic — webview-panel viewTypes are runtime-only strings VS Code
 *     never associates with an extension, but in practice they embed the
 *     extension's name (`claudeVSCodePanel`, `gitlens.graph`…). Each
 *     extension's name is tokenized, generic words ("vscode", "preview"…) are
 *     dropped, and a candidate matches only when EVERY distinctive token
 *     appears in the viewType. Ties go to the longest (most specific) match;
 *     no match falls back to the caller's codicon.
 *
 * Icons load lazily — the first bay that needs one goes through the same
 * deferred-patch path as file icons (see IconRenderer/patchIcons) — and are
 * cached per extension id as base64 data URIs (the webview CSP allows
 * `img-src data:`). The exception is ICON_OVERRIDES, warmed at preload so
 * their tabs get the brand icon on the very first paint.
 */

/**
 * Hand-picked icon resources (relative to the extension root) for extensions
 * whose marketplace icon reads badly at 16px; consulted instead of
 * `packageJSON.icon` at load time. Claude Code ships a compact brand SVG.
 */
const ICON_OVERRIDES: Record<string, string> = {
  'anthropic.claude-code': 'resources/claude-logo.svg',
};

/** Words too generic to identify an extension inside a viewType. */
const GENERIC_TOKENS = new Set([
  'vscode', 'code', 'visual', 'studio', 'view', 'panel', 'editor', 'preview',
  'webview', 'web', 'extension', 'ext', 'plugin', 'tools', 'tool', 'support',
  'language', 'lang', 'client', 'server', 'the', 'for', 'and', 'dev',
]);

/** Tab viewTypes arrive prefixed with the hosting thread's marker. */
const VIEWTYPE_PREFIX = /^mainThread(?:Webview|CustomEditor)-/;

const MIME_BY_SUFFIX: Record<string, string> = {
  svg  : 'image/svg+xml',
  gif  : 'image/gif',
  jpg  : 'image/jpeg',
  jpeg : 'image/jpeg',
};

type Candidate = { ext: vscode.Extension<unknown>; tokens: string[]; score: number };

type ExtensionManifest = {
  publisher?   : string;
  name?        : string;
  displayName? : string;
  icon?        : string;
  contributes? : { customEditors?: { viewType?: string }[] };
};

/** Resultado del lookup síncrono del primer pintado. */
export type WebviewIconLookup =
  | { state: 'loaded'; dataUri: string } // en caché: pintar ya
  | { state: 'deferrable' }              // hay dueña candidata: cargar en diferido
  | { state: 'none' };                   // sin match (o la carga ya falló): codicon

// extension id → data URI, or null once loading failed (stops further deferrals).
const iconDataUri = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

// Index over installed extensions, rebuilt by preload (also on extensions.onDidChange).
let candidates: Candidate[] = [];
let byViewType = new Map<string, vscode.Extension<unknown>>();
let byDisplayName = new Map<string, vscode.Extension<unknown>>();

/**
 * (Re)builds the installed-extension index and warms the override icons. Safe
 * to call more than once (e.g. after an extension is installed mid-session).
 */
export async function preloadWebviewExtensionIcons(): Promise<void> {
  buildExtensionIndex();

  await Promise.all(
    Object.keys(ICON_OVERRIDES)
      .map(id => vscode.extensions.getExtension(id))
      .filter((ext): ext is vscode.Extension<unknown> => ext !== undefined)
      .map(ext => loadExtensionIcon(ext)),
  );
}

/**
 * Synchronous lookup for the first paint: matches the owning extension and
 * answers from the cache only. A `deferrable` result should be resolved later
 * via `resolveWebviewExtensionIconAsync` (deferred icon patch).
 */
export function lookupWebviewExtensionIcon(viewType?: string, label?: string): WebviewIconLookup {
  const ext = matchExtension(viewType, label);
  if (!ext) { return { state: 'none' }; }

  const cached = iconDataUri.get(ext.id);
  if (typeof cached === 'string') { return { state: 'loaded', dataUri: cached }; }
  return cached === null ? { state: 'none' } : { state: 'deferrable' };
}

/**
 * Async resolution for the deferred icon patch: reads the matched extension's
 * icon from disk (`vscode.workspace.fs`, so it also works on remotes) and
 * caches it. Null → caller keeps the codicon placeholder.
 */
export async function resolveWebviewExtensionIconAsync(viewType?: string, label?: string): Promise<string | null> {
  const ext = matchExtension(viewType, label);
  if (!ext) { return null; }
  return loadExtensionIcon(ext);
}

//= INTERNALS

function buildExtensionIndex(): void {
  candidates    = [];
  byViewType    = new Map();
  byDisplayName = new Map();

  for (const ext of vscode.extensions.all) {
    const pkg = ext.packageJSON as ExtensionManifest;

    // Built-ins (Settings, Welcome, markdown preview…) keep their codicons.
    if (pkg.publisher === 'vscode') { continue; }
    // Nothing to render → not worth matching.
    if (!pkg.icon && !ICON_OVERRIDES[ext.id]) { continue; }

    for (const editor of pkg.contributes?.customEditors ?? []) {
      if (editor.viewType) { byViewType.set(editor.viewType.toLowerCase(), ext); }
    }

    // `%key%` displayNames are unresolved localization placeholders.
    if (pkg.displayName && !pkg.displayName.startsWith('%')) {
      byDisplayName.set(pkg.displayName.toLowerCase(), ext);
    }

    const tokens = (pkg.name ?? '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(t => t.length >= 3 && !/^\d+$/.test(t) && !GENERIC_TOKENS.has(t));
    if (tokens.length > 0) {
      candidates.push({ ext, tokens, score: tokens.join('').length });
    }
  }
}

function matchExtension(viewType?: string, label?: string): vscode.Extension<unknown> | undefined {
  // Extension detail page: exact displayName match, no heuristics needed.
  if (label?.startsWith(EXTENSION_PAGE_PREFIX)) {
    const byName = byDisplayName.get(label.slice(EXTENSION_PAGE_PREFIX.length).toLowerCase());
    if (byName) { return byName; }
  }

  if (!viewType) { return undefined; }
  const raw = viewType.replace(VIEWTYPE_PREFIX, '').toLowerCase();

  const declared = byViewType.get(raw);
  if (declared) { return declared; }

  // All-tokens-present, longest match wins (keeps "git" from stealing "gitlens").
  let best: Candidate | undefined;
  for (const candidate of candidates) {
    if (!candidate.tokens.every(t => raw.includes(t))) { continue; }
    if (!best || candidate.score > best.score) { best = candidate; }
  }
  return best?.ext;
}

/** Cache → in-flight read → disk. Concurrent callers share one read. */
function loadExtensionIcon(ext: vscode.Extension<unknown>): Promise<string | null> {
  const known = iconDataUri.get(ext.id);
  if (known !== undefined) { return Promise.resolve(known); }

  let loading = inflight.get(ext.id);
  if (!loading) {
    loading = readExtensionIcon(ext).finally(() => inflight.delete(ext.id));
    inflight.set(ext.id, loading);
  }
  return loading;
}

async function readExtensionIcon(ext: vscode.Extension<unknown>): Promise<string | null> {
  try {
    const iconPath = ICON_OVERRIDES[ext.id] ?? (ext.packageJSON as ExtensionManifest).icon;
    if (!iconPath) {
      iconDataUri.set(ext.id, null);
      return null;
    }

    const uri     = vscode.Uri.joinPath(ext.extensionUri, ...iconPath.split('/'));
    const bytes   = await vscode.workspace.fs.readFile(uri);
    const mime    = MIME_BY_SUFFIX[iconPath.split('.').pop()?.toLowerCase() ?? ''] ?? 'image/png';
    const dataUri = `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;

    iconDataUri.set(ext.id, dataUri);
    Logger.log(`[WebviewIcons] Loaded icon for ${ext.id}`);
    return dataUri;
  } catch (err) {
    Logger.warn(`[WebviewIcons] Could not load icon for ${ext.id}: ${err instanceof Error ? err.message : String(err)}`);
    iconDataUri.set(ext.id, null);
    return null;
  }
}
