import * as vscode from 'vscode';
import * as path from 'path';
import { Logger } from '../utils/logger';
import { VSCODE_COMMANDS } from '../constants/commands';
import type { BayMetadata, BayState, BayCapabilities, BayViewMode as BayViewMode, BayType } from './Bay';

//· --- CONSTANTES ---
const MARKDOWN_PREVIEW_PREFIX = 'Preview ';
const MARKDOWN_PREVIEW_VIEWTYPE = 'markdown.preview';
const PREVIEWABLE_EXTENSIONS = [
  '.md', '.mdx', '.markdown', // Markdown
  '.html', '.htm',            // HTML
  '.svg',                     // SVG
  '.pdf',                     // PDF
  '.ipynb',                   // Jupyter notebooks
];

//· --- BAY HELPERS PRINCIPAL ---
/**
 * Utilidades auxiliares para interactuar con pestañas nativas de VS Code y para enriquecer metadata/state.
 * Métodos agrupados por responsabilidad: nativo, metadata, capacidades, estado.
 */
export class BayHelpers {
  //· --- CONSTANTES DE COMANDOS ---
  private static readonly WEBVIEW_COMMANDS: Record<string, string> = {
    'settings': 'workbench.action.openSettings',
    'keyboard shortcuts': 'workbench.action.openGlobalKeybindings',
    'welcome': 'workbench.action.showWelcomePage',
    'release notes': 'update.showCurrentReleaseNotes',
    'interactive playground': 'workbench.action.showInteractivePlayground',
  };
  private static readonly FOCUS_GROUP_CMDS: Record<number, string> = {
    1: 'workbench.action.focusFirstEditorGroup',
    2: 'workbench.action.focusSecondEditorGroup',
    3: 'workbench.action.focusThirdEditorGroup',
    4: 'workbench.action.focusFourthEditorGroup',
    5: 'workbench.action.focusFifthEditorGroup',
    6: 'workbench.action.focusSixthEditorGroup',
    7: 'workbench.action.focusSeventhEditorGroup',
    8: 'workbench.action.focusEighthEditorGroup',
  };

  //· --- SETS DE EXTENSIONES (O(1) lookup, inicializados una sola vez) ---
  private static readonly EXT_CONFIG   = new Set(['.json', '.yaml', '.yml', '.toml', '.ini', '.env']);
  private static readonly EXT_DOC      = new Set(['.md', '.txt', '.rst', '.adoc']);
  private static readonly EXT_STYLE    = new Set(['.css', '.scss', '.sass', '.less', '.styl']);
  private static readonly EXT_SCRIPT   = new Set(['.js', '.ts', '.jsx', '.tsx', '.py', '.rb', '.sh', '.ps1', '.bat']);
  private static readonly EXT_DATA     = new Set(['.json', '.xml', '.csv', '.sql', '.db']);
  private static readonly EXT_ASSET    = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.woff', '.ttf']);
  private static readonly EXT_BINARY   = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.pdf', '.zip', '.exe', '.dll']);
  private static readonly NAME_BUILD   = new Set(['build', 'webpack', 'rollup', 'vite', 'esbuild']);

  //- --- UTILIDADES NATIVAS (VS CODE TAB) ---
  //· --- DETECCIÓN Y ACCESO NATIVO ---
  static isMarkdownPreview(metadata: BayMetadata): boolean {
    // viewType llega prefijado (p.ej. "mainThreadWebview-markdown.preview") → inclusión
    if (metadata.viewType?.includes(MARKDOWN_PREVIEW_VIEWTYPE)) { return true; }
    if (metadata.bayType === 'webview' && metadata.label.startsWith(MARKDOWN_PREVIEW_PREFIX)) { return true; }
    return false;
  }
  static isPreviewableFile(metadata: BayMetadata): boolean {
    if (!metadata.uri || metadata.bayType !== 'file') { return false; }
    const ext = metadata.fileExtension?.toLowerCase() || '';
    return PREVIEWABLE_EXTENSIONS.includes(ext);
  }
  static async focusGroup(viewColumn: vscode.ViewColumn): Promise<void> {
    const cmd = BayHelpers.FOCUS_GROUP_CMDS[viewColumn];
    if (cmd) { await vscode.commands.executeCommand(cmd); }
  }
  static async activateByNativeTab(metadata: BayMetadata, state: BayState): Promise<void> {
    const nativeTab = BayHelpers.findNativeTab(metadata, state);
    if (nativeTab) {
      const tabIndex = nativeTab.group.tabs.indexOf(nativeTab);
      if (tabIndex !== -1) {
        try {
          Logger.log(`[BayHelper] Activating by index: ${metadata.label}, index: ${tabIndex}, isPreview: ${nativeTab.isPreview}`);
          await BayHelpers.focusGroup(state.viewColumn);
          await vscode.commands.executeCommand(VSCODE_COMMANDS.OPEN_EDITOR_AT_INDEX, tabIndex);
          return;
        } catch (err) {
          Logger.error('[BayHelper] Failed to activate by index: ' + metadata.label, err);
        }
      }
    } else {
      Logger.warn('[BayHelper] Native bay not found for activation: ' + metadata.label);
      throw new Error(`Native bay not found: ${metadata.label}`);
    }
    const label = metadata.label.toLowerCase();
    for (const [keyword, cmd] of Object.entries(BayHelpers.WEBVIEW_COMMANDS)) {
      if (label.includes(keyword)) {
        try { await vscode.commands.executeCommand(cmd); return; } catch {}
      }
    }
  }

  /**  */
  static matchesNative(t: vscode.Tab, metadata: BayMetadata): boolean {
    if (t.input instanceof vscode.TabInputWebview) { return t.label === metadata.label; }
    if (!t.input) { return metadata.bayType === 'webview' && !metadata.uri && t.label === metadata.label; }
    if (t.input instanceof vscode.TabInputTextDiff) { return !!metadata.sourceBayId && metadata.uri?.toString() === t.input.modified.toString(); }
    if (metadata.sourceBayId) { return false; }
    const uri = metadata.uri;
    if (!uri) { return false; }
    if (t.input instanceof vscode.TabInputText) { return t.input.uri.toString() === uri.toString(); }
    if (t.input instanceof vscode.TabInputCustom) { return t.input.uri.toString() === uri.toString(); }
    if (t.input instanceof vscode.TabInputNotebook) { return t.input.uri.toString() === uri.toString(); }
    return false;
  }
  static findNativeTab(metadata: BayMetadata, state: BayState): vscode.Tab | undefined {
    const group = BayHelpers.nativeGroup(state.viewColumn);
    return group?.tabs.find(t => BayHelpers.matchesNative(t, metadata));
  }
  static nativeGroup(viewColumn: vscode.ViewColumn): vscode.TabGroup | undefined {
    return vscode.window.tabGroups.all.find(g => g.viewColumn === viewColumn);
  }

  //· --- METADATA Y STATE HELPERS ---
  static enrichMetadata(metadata: BayMetadata): BayMetadata {
    const enriched = { ...metadata };
    if (metadata.uri) {
      const uri = metadata.uri;
      const fsPath = uri.fsPath;
      enriched.fileName = path.basename(fsPath);
      const ext = path.extname(fsPath);
      enriched.baseName = ext ? path.basename(fsPath, ext) : path.basename(fsPath);
      enriched.dirPath = path.dirname(fsPath);
      enriched.scheme = uri.scheme;
      enriched.isRemote = uri.scheme !== 'file' && uri.scheme !== 'untitled';
      enriched.isUntitled = uri.scheme === 'untitled';
      enriched.isBinary = BayHelpers.EXT_BINARY.has(metadata.fileExtension.toLowerCase());
      enriched.category = BayHelpers.categorizeFile(metadata.fileName || metadata.label, metadata.fileExtension, metadata.dirPath);
    } else {
      enriched.fileName = undefined;
      enriched.baseName = undefined;
      enriched.dirPath = undefined;
      enriched.scheme = undefined;
      enriched.isRemote = false;
      enriched.isUntitled = false;
      enriched.isBinary = false;
      enriched.category = BayHelpers.categorizeNonFileTab(metadata.bayType, metadata.label);
    }
    return enriched;
  }

  private static categorizeFile(fileName: string, ext: string, dirPath?: string): string {
    const name = fileName.toLowerCase();
    const dir = dirPath?.toLowerCase() || '';
    const extension = ext.toLowerCase();
    if (name.includes('config') || name.includes('settings') || BayHelpers.EXT_CONFIG.has(extension) || (name.startsWith('.') && !extension)) { return 'config'; }
    if (name.includes('test') || name.includes('spec') || dir.includes('test') || dir.includes('__tests__')) { return 'test'; }
    if (BayHelpers.EXT_DOC.has(extension) || name === 'readme' || name === 'license') { return 'doc'; }
    if (BayHelpers.EXT_STYLE.has(extension)) { return 'style'; }
    if (BayHelpers.EXT_SCRIPT.has(extension)) { return dir.includes('script') ? 'script' : 'component'; }
    if (BayHelpers.EXT_DATA.has(extension)) { return 'data'; }
    if ([...BayHelpers.NAME_BUILD].some(kw => name.includes(kw))) { return 'build'; }
    if (BayHelpers.EXT_ASSET.has(extension)) { return 'asset'; }
    return 'file';
  }
  private static categorizeNonFileTab(bayType: BayType, label: string): string {
    if (bayType === 'webview') {
      const lower = label.toLowerCase();
      if (lower.includes('settings')) { return 'settings'; }
      if (lower.includes('extension')) { return 'extensions'; }
      if (lower.includes('welcome')) { return 'welcome'; }
      if (lower.includes('output')) { return 'output'; }
      return 'webview';
    }
    if (bayType === 'notebook') { return 'notebook'; }
    return 'file';
  }

  //= --- CAPABILITIES Y STATE ---
  static computeCapabilities(metadata: BayMetadata, state: Partial<BayState>): BayCapabilities {
    const hasUri = !!metadata.uri;
    const isFile = metadata.bayType === 'file';
    const isDiff = !!metadata.sourceBayId;
    const ext = metadata.fileExtension.toLowerCase();
    const supportsPreview = ['.md', '.svg', '.html', '.htm'].includes(ext);
    return {
      canClose: true,
      canPin: !state.isPinned && !isDiff,
      canRevealInExplorer: hasUri && metadata.scheme === 'file',
      canTogglePreview: supportsPreview && hasUri,
      canHaveChildren: isFile && hasUri,
    };
  }

  static createDefaultState(): Partial<BayState> {
    return {
      viewMode: 'source',
      actionContext: {
        viewMode: 'source',
        editMode: 'editable',
        compareMode: false,
        debugMode: false,
      },
      operationState: {
        isProcessing: false,
        canCancel: false,
      },
      capabilities: BayHelpers.createEmptyCapabilities(),
      permissions: {
        canRename: true,
        canDelete: true,
        canMove: true,
        canShare: true,
        canExport: true,
        restrictedActions: [],
      },
      hasVariant: false,
      isVariant: false,
      variantCount: 0,
      isLoading: false,
      hasError: false,
      errorMessage: undefined,
      isHighlighted: false,
      lastAccessTime: Date.now(),
      syncVersion: 0,
      gitStatus: null,
      diagnosticSeverity: null,
      isTransient: false,
      isProtected: false,
      integrations: {
        copilot: { inContext: false },
        git: { hasUncommittedChanges: false },
      },
      customActions: undefined,
      shortcuts: undefined,
    };
  }

  private static createEmptyCapabilities(): BayCapabilities {
    return {
      canClose: false,
      canPin: false,
      canRevealInExplorer: false,
      canTogglePreview: false,
      canHaveChildren: false,
    };
  }

  // --- MAPEO DE MODOS ---
  static mapPreviewModeToViewMode(previewMode: boolean): BayViewMode {
    return previewMode ? 'preview' : 'source';
  }
  static mapViewModeToPreviewMode(viewMode: BayViewMode): boolean {
    return viewMode === 'preview';
  }
}
