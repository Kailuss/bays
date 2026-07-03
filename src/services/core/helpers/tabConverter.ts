import * as vscode from 'vscode';
import * as path from 'path';
import { Bay                                 } from '../../../models/Bay';
import type { BayMetadata, BayState, BayType } from '../../../models/Bay';
import { BayHelpers                          } from '../../../models/BayHelpers';
import type { GitSyncService                 } from '../../integration/GitSyncService';
import { formatFilePathWithParts             } from '../../../utils/pathFormatters';
import { Logger                              } from '../../../utils/logger';
import { classifyDiffType, determineParentId } from './tabClassifier';

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
  
  // Filtrar tabs de Markdown Preview - NO crear Bay para ellas
  // Se manejan como estado toggle (viewMode) en la bay source.
  // El viewType llega prefijado (p.ej. "mainThreadWebview-markdown.preview"),
  // por eso se compara por inclusión y no por igualdad estricta.
  if (viewType?.includes('markdown.preview')) {
    Logger.log(`[TabConverter] Filtering markdown preview tab: ${label}`);
    return null;
  }
  
  // También filtrar por label (fallback para casos donde viewType no está disponible)
  if (tabType === 'webview' && label.startsWith('Preview ')) {
    Logger.log(`[TabConverter] Filtering preview tab by label: ${label}`);
    return null;
  }
  const viewColumn = VSTab.group.viewColumn;

  let parentId  : string | undefined;
  let diffType  : import('../../../models/Bay').DiffType | undefined;
  let diffStats : import('../../../models/Bay').DiffStats | undefined;

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

    parentId = determineParentId(diffType, uri, viewColumn, originalUri, modifiedUri);
  }
  else if (tabType === 'file' && uri && uri.scheme === 'chat-editing-snapshot-text-model') {
    diffType = 'snapshot';
    // El parent es el archivo real (convertir path del snapshot a file:// URI)
    const parentUri = vscode.Uri.file(uri.path);
    parentId = `${parentUri.toString()}-${viewColumn}`;
  }

  const baseMetadata: BayMetadata = {
    id            : generateId(label, uri, viewColumn, tabType, !!parentId),
    sourceBayId: parentId,
    diffType,
    uri,
    label,
    detailLabel   : description,
    pathParts,
    tooltipText   : tooltip,
    fileExtension : fileType,
    bayType       : tabType,
    viewType,
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

  // preferPreview drives whether activating a Markdown bay opens the rendered
  // preview, and drives the preview↔source toggle button. It is deterministic
  // (only the user's toggle changes it), so it never races with the live
  // preview-ownership sync. Initialise it from the setting for Markdown files.
  const isMarkdownFile = ['.md', '.mdx', '.markdown'].includes((fileType || '').toLowerCase());
  const preferPreview  = isMarkdownFile
    ? vscode.workspace.getConfiguration('bays').get<boolean>('openPreviewableInPreview', true)
    : undefined;
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
    preferPreview,

    actionContext  : stateWithDefaults.actionContext!,
    operationState : stateWithDefaults.operationState!,

    capabilities,
    permissions    : stateWithDefaults.permissions!,

    hasVariant    : false,
    isVariant        : !!parentId, // Variants have parentId set
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

    customActions  : stateWithDefaults.customActions,
    shortcuts      : stateWithDefaults.shortcuts,
  };

  return new Bay(metadata, state);
}

/**
 * Genera un ID único y estable para una bay.
 * Archivos: URI + viewColumn. Webviews: label sanitizado. Diffs: prefijo "diff:".
 */
let diffIdCounter = 0;

export function generateId(
  label      : string,
  uri        : vscode.Uri | undefined,
  viewColumn : vscode.ViewColumn,
  tabType    : BayType,
  isDiff?    : boolean,
): string {
  if (uri) {
    if (isDiff) {
      const timestamp        = Date.now();
      const counter          = diffIdCounter++;
      const safeLabelSegment = label.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
      return `diff:${uri.toString()}-${safeLabelSegment}-${timestamp}-${counter}-${viewColumn}`;
    }
    return `${uri.toString()}-${viewColumn}`;
  }
  const safe = label.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
  return `${tabType}:${safe}-${viewColumn}`;
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
  const { uri, label, tabType } = extractTabInputData(VSTab);
  return generateId(label, uri, VSTab.group.viewColumn, tabType);
}
