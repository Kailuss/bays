import * as vscode from 'vscode';
import * as path from 'path';
import { Bay                                 } from '../../../models/Bay';
import type { BayMetadata, BayState, BayType } from '../../../models/Bay';
import { BayHelpers                          } from '../../../models/BayHelpers';
import type { GitSyncService                 } from '../../integration/GitSyncService';
import { formatFilePathWithParts             } from '../../../utils/pathFormatters';
import { resolveLanguageId                   } from '../../../utils/languageRegistry';
import { Logger                              } from '../../../utils/logger';
import { classifyDiffType, determineParentId, determineParentUri, resolveSourceUri } from './tabClassifier';

type TabInputData = {
  uri?         : vscode.Uri;
  label        : string;
  description? : string;
  pathParts?   : string[];
  tooltip      : string;
  fileType     : string;
  tabType      : BayType;
  viewType?    : string;
  originalUri? : vscode.Uri;
  modifiedUri? : vscode.Uri;
};

function extractTabInputData(VSTab: vscode.Tab): TabInputData {
  const input = VSTab.input;

  if (input instanceof vscode.TabInputText) {
    const uri = input.uri;
    const pathData = formatFilePathWithParts(uri, { useWorkspaceRelative: true });
    return {
      uri,
      label       : path.basename(uri.fsPath),
      description : pathData.formatted,
      pathParts   : pathData.parts,
      tooltip     : uri.fsPath,
      fileType    : path.extname(uri.fsPath),
      tabType     : 'file',
    };
  }

  if (input instanceof vscode.TabInputTextDiff) {
    const originalUri = input.original;
    const modifiedUri = input.modified;
    const uri = modifiedUri;

    if (uri) {
      const pathData = formatFilePathWithParts(uri, { useWorkspaceRelative: true });
      return {
        uri,
        label       : VSTab.label,
        description : pathData.formatted,
        pathParts   : pathData.parts,
        tooltip     : `${originalUri?.fsPath || '?'} ↔ ${uri.fsPath}`,
        fileType    : path.extname(uri.fsPath),
        tabType     : 'file',
        originalUri,
        modifiedUri,
      };
    }

    return {
      uri         : undefined,
      label       : VSTab.label,
      description : undefined,
      tooltip     : VSTab.label,
      fileType    : '',
      tabType     : 'file',
      originalUri,
      modifiedUri,
    };
  }

  if (input instanceof vscode.TabInputWebview) {
    return {
      uri         : undefined,
      label       : VSTab.label,
      description : undefined,
      tooltip     : VSTab.label,
      fileType    : '',
      tabType     : 'webview',
      viewType    : input.viewType,
    };
  }

  if (input instanceof vscode.TabInputCustom) {
    const uri = input.uri;
    const pathData = formatFilePathWithParts(uri, { useWorkspaceRelative: true });
    return {
      uri,
      label       : path.basename(uri.fsPath) || VSTab.label || 'Custom',
      description : pathData.formatted,
      pathParts   : pathData.parts,
      tooltip     : uri.fsPath,
      fileType    : path.extname(uri.fsPath),
      tabType     : 'custom',
      viewType    : input.viewType,
    };
  }

  if (input instanceof vscode.TabInputNotebook) {
    const uri = input.uri;
    const pathData = formatFilePathWithParts(uri, { useWorkspaceRelative: true });
    return {
      uri,
      label       : path.basename(uri.fsPath),
      description : pathData.formatted,
      pathParts   : pathData.parts,
      tooltip     : uri.fsPath,
      fileType    : path.extname(uri.fsPath),
      tabType     : 'notebook',
    };
  }

  return {
    uri         : undefined,
    label       : VSTab.label,
    description : undefined,
    tooltip     : VSTab.label,
    fileType    : '',
    tabType     : 'file',
  };
}

/**
 * Convierte una tab nativa de VS Code a Bay.
 * Extrae metadata, calcula parentId para diffs, y construye el estado completo.
 * 
 * FILTRADO: Las tabs de Markdown Preview (viewType === 'markdown.preview') NO se convierten
 * a Bays. Solo se rastrea su existencia para actualizar el viewMode de la bay source.
 */
export function convertToBay(
  VSTab      : vscode.Tab,
  gitService : GitSyncService,
  index?     : number
): Bay | null {
  const inputData = extractTabInputData(VSTab);
  const { uri, label, description, pathParts, tooltip, fileType, tabType, viewType, originalUri, modifiedUri } = inputData;
  
  const viewColumn = VSTab.group.viewColumn;

  let parentId  : string | undefined;
  let parentUri : vscode.Uri | undefined;
  let diffType  : import('../../../models/Bay').DiffType | undefined;
  let diffStats : import('../../../models/Bay').DiffStats | undefined;

  // Las tabs de Markdown Preview se modelan como VARIANTES de su bay source
  // (misma arquitectura que los diffs): fila hija bajo el .md, con estado
  // activo/grupo/cierre nativos. El viewType llega prefijado por VS Code
  // (p.ej. "mainThreadWebview-markdown.preview") → comparar por inclusión.
  if (tabType === 'webview' && viewType?.includes('markdown.preview')) {
    diffType = 'preview';
    const previewSource = findPreviewSource(VSTab);
    parentId = previewSource?.id;
    parentUri = previewSource?.uri;
    Logger.log(`[TabConverter] Markdown preview as variant: ${label} → parent: ${parentId ?? 'none (orphan)'}`);
  }

  if (VSTab.input instanceof vscode.TabInputTextDiff && uri) {
    diffType = classifyDiffType(label, originalUri, modifiedUri);

    // Si es una edición de Copilot, extraer stats del label aquí
    if (diffType === 'edit') {
      const statsMatch = VSTab.label.match(/[+](\d+)[-](\d+)/);
      if (statsMatch) {
        diffStats = {
          linesAdded   : parseInt(statsMatch[1], 10),
          linesRemoved : parseInt(statsMatch[2], 10),
        };
      }
    }

    parentId  = determineParentId(diffType, uri, viewColumn, originalUri, modifiedUri);
    parentUri = determineParentUri(diffType, uri, originalUri, modifiedUri);
  }
  else if (tabType === 'file' && uri && uri.scheme === 'chat-editing-snapshot-text-model') {
    diffType = 'snapshot';
    // El parent es el archivo real (convertir path del snapshot a file:// URI)
    parentUri = resolveSourceUri(uri);
    parentId  = `${parentUri.toString()}-${viewColumn}`;
  }

  // Variant (diff/snapshot) bays get a DETERMINISTIC id so the close/active-sync
  // paths — which recompute the id from the native tab via generateIdFromNativeTab —
  // can actually match them. modified+original URI + viewColumn uniquely identify a
  // diff tab and are all recoverable from the native tab.
  let id: string;
  if (VSTab.input instanceof vscode.TabInputTextDiff && modifiedUri) {
    id = generateVariantId(modifiedUri, originalUri, viewColumn);
  } else if (uri && uri.scheme === 'chat-editing-snapshot-text-model') {
    id = generateVariantId(uri, undefined, viewColumn);
  } else {
    id = generateId(label, uri, viewColumn, tabType, viewType);
  }

  const baseMetadata: BayMetadata = {
    id,
    sourceBayId: parentId,
    sourceUri  : parentUri,
    diffType,
    uri,
    originalUri,
    label,
    detailLabel   : description,
    pathParts,
    tooltipText   : tooltip,
    fileExtension : fileType,
    bayType       : tabType,
    viewType,
    // Se deriva del nombre de archivo (registro de lenguajes contribuidos) en vez
    // de leer `document.languageId`: las tabs restauradas no tienen documento
    // cargado al arrancar y abrirlo despertaría todas las extensiones de lenguaje.
    languageId    : uri ? resolveLanguageId(path.basename(uri.fsPath)) : undefined,
  };

  const metadata = BayHelpers.enrichMetadata(baseMetadata);

  const baseState = {
    isActive           : VSTab.isActive,
    isDirty            : VSTab.isDirty,
    isPinned           : VSTab.isPinned,
    isPreview          : VSTab.isPreview,
    groupId            : viewColumn,
    viewColumn,
    indexInGroup       : index ?? 0,
    gitStatus          : uri ? gitService.getGitStatus(uri) : null,
    diagnosticSeverity : uri ? getDiagnosticSeverity(uri) : null,
  };

  const defaultState      = BayHelpers.createDefaultState();
  const stateWithDefaults = { ...defaultState, ...baseState };
  const capabilities      = BayHelpers.computeCapabilities(metadata, stateWithDefaults);
  const viewMode          = BayHelpers.mapPreviewModeToViewMode(false);
  const state: BayState   = {

    // VS CODE NATIVE STATE
    isActive       : VSTab.isActive,
    isDirty        : VSTab.isDirty,
    isPinned       : VSTab.isPinned,
    isPreview      : VSTab.isPreview,

    // LOCATION
    groupId        : viewColumn,
    viewColumn,
    indexInGroup   : index ?? 0,

    // VISUALIZATION MODE
    viewMode,

    capabilities,

    hasVariant    : false,
    variantCount  : 0,

    isLoading      : false,
    hasError       : false,
    errorMessage   : undefined,
    isHighlighted  : false,

    lastAccessTime : Date.now(),
    syncVersion    : 0,

    gitStatus      : uri ? gitService.getGitStatus(uri) : null,
    diagnosticSeverity : uri ? getDiagnosticSeverity(uri) : null,

    isTransient    : false,
    isProtected    : false,

    integrations   : stateWithDefaults.integrations!,

    diffStats,
  };

  return new Bay(metadata, state);
}

/**
 * Rebuilds a plain file/custom/notebook bay for a NEW uri after a rename/move.
 *
 * Deterministic on purpose: it derives everything from `newUri` (mirroring the file
 * branch of convertToBay) and carries the native flags — isActive/isDirty/isPinned/
 * isPreview, which a pure move does not change — from the old bay's state. It never
 * reads the native tab, so re-keying does NOT depend on whether VS Code has already
 * propagated the tab-model update to the extension host when onDidRenameFiles fires.
 *
 * Caller contract: `oldBay` is a plain bay (no sourceBayId, no variants). Diff/variant
 * remaps are handled by a full resync, which can rewire ids and links together.
 */
export function remapFileBayUri(
  oldBay     : Bay,
  newUri     : vscode.Uri,
  gitService : GitSyncService,
): Bay {
  const viewColumn = oldBay.state.viewColumn;
  const pathData   = formatFilePathWithParts(newUri, { useWorkspaceRelative: true });
  const label      = path.basename(newUri.fsPath);
  const fileType   = path.extname(newUri.fsPath);

  // Mirror convertToBay's file-branch baseMetadata, but for the new uri. bayType/
  // viewType/customData are the only non-uri fields worth carrying over.
  const baseMetadata: BayMetadata = {
    id            : `${newUri.toString()}-${viewColumn}`,
    uri           : newUri,
    label,
    detailLabel   : pathData.formatted,
    pathParts     : pathData.parts,
    tooltipText   : newUri.fsPath,
    fileExtension : fileType,
    bayType       : oldBay.metadata.bayType,
    viewType      : oldBay.metadata.viewType,
    languageId    : resolveLanguageId(label),
    customData    : oldBay.metadata.customData,
  };

  const metadata = BayHelpers.enrichMetadata(baseMetadata);

  // Clone the current mutable state; only the uri-derived facets change on a move.
  const state: BayState = {
    ...oldBay.state,
    capabilities       : BayHelpers.computeCapabilities(metadata, oldBay.state),
    gitStatus          : gitService.getGitStatus(newUri),
    diagnosticSeverity : getDiagnosticSeverity(newUri),
    lastAccessTime     : Date.now(),
  };

  return new Bay(metadata, state);
}

/**
 * Genera un ID único y estable para una bay.
 * Archivos: URI + viewColumn. Webviews: viewType sanitizado.
 * (Los diffs no pasan por aquí: usan generateVariantId.)
 */
export function generateId(
  label      : string,
  uri        : vscode.Uri | undefined,
  viewColumn : vscode.ViewColumn,
  tabType    : BayType,
  viewType?  : string,
): string {
  if (uri) {
    return `${uri.toString()}-${viewColumn}`;
  }
  // Uriless tabs (webviews): key off the STABLE viewType, not the mutable label.
  // Some webview panels rewrite their title at runtime — e.g. Claude Code's chat
  // tab (`mainThreadWebview-claudeVSCodePanel`) shows the current session name — so
  // a label-derived id drifts on every title change, orphaning the bay and breaking
  // active-highlight/close sync. The viewType is fixed for the panel's lifetime.
  const key = (viewType || label).replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
  return `${tabType}:${key}-${viewColumn}`;
}

/**
 * Deterministic, reconstructable id for a diff/variant tab. Derives solely from
 * the modified/original URIs and viewColumn — all available on the native tab —
 * so the open path and the close/active-sync paths agree on the same id.
 * Including the original URI also disambiguates two different diffs of the same
 * file in one group.
 */
export function generateVariantId(
  modifiedUri : vscode.Uri,
  originalUri : vscode.Uri | undefined,
  viewColumn  : vscode.ViewColumn,
): string {
  const original = originalUri ? originalUri.toString() : '';
  return `diff:${modifiedUri.toString()}::${original}-${viewColumn}`;
}

/**
 * Obtiene la severidad más alta de diagnóstico para un archivo.
 * Retorna Error o Warning, o null si no hay diagnósticos relevantes.
 */
export function getDiagnosticSeverity(uri: vscode.Uri): vscode.DiagnosticSeverity | null {
  const diagnostics = vscode.languages.getDiagnostics(uri);
  if (diagnostics.length === 0) { return null; }

  let maxSeverity: vscode.DiagnosticSeverity | null = null;
  for (const diagnostic of diagnostics) {
    if (maxSeverity === null || diagnostic.severity < maxSeverity) {
      maxSeverity = diagnostic.severity;
    }
  }

  if (maxSeverity === vscode.DiagnosticSeverity.Error || 
      maxSeverity === vscode.DiagnosticSeverity.Warning) {
    return maxSeverity;
  }

  return null;
}

/**
 * Extrae un ID de una tab nativa sin crear un Bay completo.
 * Usado para mejor performance en operaciones de sincronización.
 */
export function generateIdFromNativeTab(VSTab: vscode.Tab): string | null {
  const { uri, label, tabType, viewType, originalUri, modifiedUri } = extractTabInputData(VSTab);
  // Must mirror convertToBay's id derivation exactly, or close/active-sync lookups
  // for diff/variant tabs silently miss their stored bay.
  if (VSTab.input instanceof vscode.TabInputTextDiff && modifiedUri) {
    return generateVariantId(modifiedUri, originalUri, VSTab.group.viewColumn);
  }
  if (uri && uri.scheme === 'chat-editing-snapshot-text-model') {
    return generateVariantId(uri, undefined, VSTab.group.viewColumn);
  }
  // Pass viewType so webview ids stay stable across the panel's runtime title
  // changes — mirrors convertToBay exactly (see generateId).
  return generateId(label, uri, VSTab.group.viewColumn, tabType, viewType);
}

/**
 * Resuelve el ID de la bay source de una tab de Markdown Preview.
 *
 * El label del preview es "<prefijo localizado> <archivo.md>" ("Preview x.md",
 * "Vista previa x.md", …), así que se empareja por el NOMBRE DE ARCHIVO al
 * final del label (con frontera de espacio), nunca por el prefijo. Se prefiere
 * una tab de texto en el mismo grupo; si el preview vive en otro grupo (Open
 * Preview to the Side) se acepta un match global solo si es inequívoco.
 * Devuelve undefined si no hay source abierta (la variante quedará huérfana).
 */
function findPreviewSource(previewTab: vscode.Tab): { id: string; uri: vscode.Uri } | undefined {
  const label = previewTab.label;

  const matches = (tab: vscode.Tab): boolean => {
    if (!(tab.input instanceof vscode.TabInputText)) { return false; }
    const fileName = path.basename(tab.input.uri.fsPath);
    if (!fileName.match(/\.(md|mdx|markdown)$/i)) { return false; }
    return label === fileName || label.endsWith(' ' + fileName);
  };

  const describe = (tab: vscode.Tab) => {
    const input = tab.input as vscode.TabInputText;
    return { id: `${input.uri.toString()}-${tab.group.viewColumn}`, uri: input.uri };
  };

  // Prefer the preview's own group
  for (const tab of previewTab.group.tabs) {
    if (matches(tab)) { return describe(tab); }
  }

  // Fall back to a global match only when unambiguous
  const candidates: vscode.Tab[] = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (matches(tab)) { candidates.push(tab); }
    }
  }
  if (candidates.length === 1) {
    return describe(candidates[0]);
  }
  return undefined;
}
