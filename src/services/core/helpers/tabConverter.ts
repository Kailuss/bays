import * as vscode from 'vscode';
import * as path from 'path';
import { SideTab } from '../../../models/Bay';
import type { BayMetadata, BayState, BayType } from '../../../models/Bay';
import { BayHelpers } from '../../../models/BayHelpers';
import type { GitSyncService } from '../../integration/GitSyncService';
import { formatFilePath } from '../../../utils/helpers';
import { classifyDiffType, determineParentId } from './tabClassifier';

/**
 * Funciones puras para convertir tabs nativas de VS Code a SideTabs.
 * 
 * Separado de TabSyncService para:
 * - Facilitar testing (funciones puras, sin estado)
 * - Reducir complejidad de TabSyncService
 * - Reutilización en otros módulos
 * 
 * IMPORTANTE:
 * - Las tabs de webview (Settings, Extensions) tienen uri: undefined
 * - NUNCA crear URIs falsas (untitled:, bays://) → causa [UriError]
 * - Todas las 4 TabInput types deben ser soportadas
 * 
 * @see docs/PLAN_OPTIMIZACION_TABSYNC.md
 */

/**
 * Convierte una tab nativa de VS Code a nuestro modelo SideTab.
 * 
 * Explicación simple:
 * - Si es un archivo (texto, editor custom, notebook) recoge la uri, el nombre
 *   del archivo, la ruta relativa y la extensión.
 * - Si es una tab webview (Settings, Extensions, Welcome), NO crea una URI
 *   falsa; deja uri sin definir y genera un id estable basado en la etiqueta.
 * - El método solo transforma datos y devuelve un SideTab listo para la UI.
 * 
 * @param tab Tab nativa de VS Code
 * @param gitService Servicio de Git para obtener git status
 * @param index Índice opcional en el grupo
 * @returns SideTab o null si el tipo no es soportado
 */
export function convertToSideTab(
  tab: vscode.Tab,
  gitService: GitSyncService,
  index?: number
): SideTab | null {
  let uri: vscode.Uri | undefined;
  let label: string;
  let description: string | undefined;
  let tooltip: string;
  let fileType: string = '';
  let tabType: BayType = 'file';
  let viewType: string | undefined;
  
  // Guardar URIs original y modificado para tabs diff (necesario para clasificación)
  let originalUri: vscode.Uri | undefined;
  let modifiedUri: vscode.Uri | undefined;

  if (tab.input instanceof vscode.TabInputText) {
    uri = tab.input.uri;
    label = path.basename(uri.fsPath);
    description = formatFilePath(uri, { useWorkspaceRelative: true });
    tooltip = uri.fsPath;
    fileType = path.extname(uri.fsPath);
    tabType = 'file';
  }
  else if (tab.input instanceof vscode.TabInputTextDiff) {
    // Tabs diff (Working Tree, Staged Changes, Snapshots, Compares, etc.)
    // Usar la URI modificada como URI primaria (lado derecho del diff)
    originalUri = tab.input.original;
    modifiedUri = tab.input.modified;
    uri = modifiedUri;
    
    if (uri) {
      label = tab.label;
      description = formatFilePath(uri, { useWorkspaceRelative: true });
      tooltip = `${originalUri?.fsPath || '?'} ↔ ${uri.fsPath}`;
      fileType = path.extname(uri.fsPath);
    } else {
      // Caso raro donde el diff no tiene URI modificada
      label = tab.label;
      description = undefined;
      tooltip = tab.label;
      fileType = '';
    }
    tabType = 'file'; // Variants are file type with parentId
  }
  else if (tab.input instanceof vscode.TabInputWebview) {
    // Tabs webview: Settings, Extensions, etc.
    // CRÍTICO: NO crear URIs falsas → uri permanece undefined
    uri = undefined;
    label = tab.label;
    description = undefined;
    tooltip = tab.label;
    fileType = '';
    tabType = 'webview';
    viewType = tab.input.viewType;
  }
  else if (tab.input instanceof vscode.TabInputCustom) {
    uri = tab.input.uri;
    label = path.basename(uri.fsPath) || tab.label || 'Custom';
    description = formatFilePath(uri, { useWorkspaceRelative: true });
    tooltip = uri.fsPath;
    fileType = path.extname(uri.fsPath);
    tabType = 'custom';
    viewType = tab.input.viewType;
  }
  else if (tab.input instanceof vscode.TabInputNotebook) {
    uri = tab.input.uri;
    label = path.basename(uri.fsPath);
    description = formatFilePath(uri, { useWorkspaceRelative: true });
    tooltip = uri.fsPath;
    fileType = path.extname(uri.fsPath);
    tabType = 'notebook';
  }
  else {
    // Tipo desconocido - capturar como fallback
    uri = undefined;
    label = tab.label;
    description = undefined;
    tooltip = tab.label;
    tabType = 'file'; // Fallback to file type
  }

  const viewColumn = tab.group.viewColumn;

  // Calcular parentId y diffType para tabs diff (vincular al tab de archivo correspondiente)
  let parentId: string | undefined;
  let diffType: import('../../../models/Bay').DiffType | undefined;
  let diffStats: import('../../../models/Bay').DiffStats | undefined;
  
  // Caso 1: Tabs diff (TabInputTextDiff) - identified by having originalUri
  if (tab.input instanceof vscode.TabInputTextDiff && uri) {
    // Clasificar el tipo de diff basándose en el label y URIs
    diffType = classifyDiffType(label, originalUri, modifiedUri);
    
    // Si es una edición de Copilot, extraer stats del label aquí
    if (diffType === 'edit') {
      const statsMatch = tab.label.match(/[+](\d+)[-](\d+)/);
      if (statsMatch) {
        diffStats = {
          linesAdded: parseInt(statsMatch[1], 10),
          linesRemoved: parseInt(statsMatch[2], 10),
        };
      }
    }
    
    // Determinar parent basándose en el tipo de diff
    parentId = determineParentId(diffType, uri, viewColumn, originalUri, modifiedUri);
  }
  // Caso 2: Tabs de snapshot como TabInputText (ej: "BaiaState.cs (Snapshot)" desde Copilot)
  else if (tabType === 'file' && uri && uri.scheme === 'chat-editing-snapshot-text-model') {
    // Es un snapshot de Copilot abierto como documento de texto
    diffType = 'snapshot';
    // El parent es el archivo real (convertir path del snapshot a file:// URI)
    const parentUri = vscode.Uri.file(uri.path);
    parentId = `${parentUri.toString()}-${viewColumn}`;
  }

  // Construir metadata base
  const baseMetadata: BayMetadata = {
    id: generateId(label, uri, viewColumn, tabType, !!parentId),
    parentId,
    diffType,
    uri,
    label,
    detailLabel: description,
    tooltipText: tooltip,
    fileExtension: fileType,
    bayType: tabType,
    viewType,
  };

  // ✨ FASE 2: Enriquecer metadata con propiedades computadas
  const metadata = BayHelpers.enrichMetadata(baseMetadata);

  // Construir estado base desde tab de VS Code
  const baseState = {
    isActive: tab.isActive,
    isDirty: tab.isDirty,
    isPinned: tab.isPinned,
    isPreview: tab.isPreview,
    groupId: viewColumn,
    viewColumn,
    indexInGroup: index ?? 0,
    gitStatus: uri ? gitService.getGitStatus(uri) : null,
    diagnosticSeverity: uri ? getDiagnosticSeverity(uri) : null,
  };

  // ✨ FASE 3: Obtener valores por defecto para nuevas propiedades
  const defaultState = BayHelpers.createDefaultState();

  // Merge defaults + base (base sobrescribe defaults)
  const stateWithDefaults = { ...defaultState, ...baseState };

  // ✨ FASE 3: Calcular capabilities basándose en metadata + state
  const capabilities = BayHelpers.computeCapabilities(metadata, stateWithDefaults);

  // ✨ FASE 4: Mapear legacy previewMode a nuevo viewMode
  const viewMode = BayHelpers.mapPreviewModeToViewMode(false); // Default a source

  // Construir estado final con todas las propiedades requeridas
  const state: BayState = {
    // VS CODE NATIVE STATE
    isActive: tab.isActive,
    isDirty: tab.isDirty,
    isPinned: tab.isPinned,
    isPreview: tab.isPreview,
    
    // LOCATION
    groupId: viewColumn,
    viewColumn,
    indexInGroup: index ?? 0,
    
    // VISUALIZATION MODE
    viewMode,
    
    // ACTION CONTEXT (from defaults)
    actionContext: stateWithDefaults.actionContext!,
    operationState: stateWithDefaults.operationState!,
    
    // CAPABILITIES & PERMISSIONS
    capabilities,
    permissions: stateWithDefaults.permissions!,
    
    // HIERARCHY
    hasChildren: false, // Se calculará después cuando se detecten children
    isChild: !!parentId, // Variants have parentId set
    childrenCount: 0,
    
    // UI STATE
    isLoading: false,
    hasError: false,
    errorMessage: undefined,
    isHighlighted: false,
    
    // TRACKING
    lastAccessTime: Date.now(),
    syncVersion: 0,
    
    // DECORATIONS
    gitStatus: uri ? gitService.getGitStatus(uri) : null,
    diagnosticSeverity: uri ? getDiagnosticSeverity(uri) : null,
    
    // PROTECTION
    isTransient: false,
    isProtected: false,
    
    // INTEGRATIONS (from defaults)
    integrations: stateWithDefaults.integrations!,
    
    // DIFF STATS (si se extrajeron durante clasificación)
    diffStats,
    
    // CUSTOMIZATION (from defaults)
    customActions: stateWithDefaults.customActions,
    shortcuts: stateWithDefaults.shortcuts,
  };

  return new SideTab(metadata, state);
}

/**
 * Genera un ID único y estable para una tab.
 * 
 * - Para archivos: basado en URI + viewColumn
 * - Para webviews: basado en label sanitizado + viewColumn
 * - Para diffs: prefijado con "diff:" para distinguir del archivo original
 * 
 * @param label Label de la tab
 * @param uri URI de la tab (undefined para webviews)
 * @param viewColumn Columna de vista
 * @param tabType Tipo de tab
 * @returns ID único
 */
// Contador global para garantizar IDs únicos de diff tabs
let diffIdCounter = 0;

export function generateId(
  label: string,
  uri: vscode.Uri | undefined,
  viewColumn: vscode.ViewColumn,
  tabType: BayType,
  isDiff?: boolean,
): string {
  if (uri) {
    // Para diff tabs (variants), usar timestamp + contador incremental para garantizar unicidad absoluta
    // Esto previene colisiones incluso si se abren múltiples diffs del mismo archivo
    if (isDiff) {
      const timestamp = Date.now();
      const counter = diffIdCounter++;
      const safeLabelSegment = label.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
      return `diff:${uri.toString()}-${safeLabelSegment}-${timestamp}-${counter}-${viewColumn}`;
    }
    return `${uri.toString()}-${viewColumn}`;
  }
  // Tabs webview no tienen URI — usar label sanitizado
  const safe = label.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
  return `${tabType}:${safe}-${viewColumn}`;
}

/**
 * Obtiene la severidad más alta de diagnóstico para un archivo.
 * 
 * @param uri URI del archivo
 * @returns Error si hay errores, Warning si hay advertencias, o null si no hay diagnósticos
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

  // Solo retornar si es Error o Warning
  if (maxSeverity === vscode.DiagnosticSeverity.Error || 
      maxSeverity === vscode.DiagnosticSeverity.Warning) {
    return maxSeverity;
  }

  return null;
}

/**
 * Extrae un ID ligero de una tab nativa — evita conversión completa a SideTab.
 * Usado por removeOrphanedTabs y syncActiveState para mejor performance.
 * 
 * @param tab Tab nativa de VS Code
 * @returns ID de la tab o null si no se puede generar
 */
export function generateIdFromNativeTab(tab: vscode.Tab): string | null {
  let uri: vscode.Uri | undefined;
  let label: string;
  let tabType: BayType;

  if (tab.input instanceof vscode.TabInputText) {
    uri = tab.input.uri;
    label = path.basename(uri.fsPath);
    tabType = 'file';
  } else if (tab.input instanceof vscode.TabInputTextDiff) {
    uri = tab.input.modified;
    label = tab.label;
    tabType = 'file'; // Variants are file type with parentId
  } else if (tab.input instanceof vscode.TabInputWebview) {
    label = tab.label;
    tabType = 'webview';
  } else if (tab.input instanceof vscode.TabInputCustom) {
    uri = tab.input.uri;
    label = path.basename(uri.fsPath) || tab.label || 'Custom';
    tabType = 'custom';
  } else if (tab.input instanceof vscode.TabInputNotebook) {
    uri = tab.input.uri;
    label = path.basename(uri.fsPath);
    tabType = 'notebook';
  } else {
    label = tab.label;
    tabType = 'file'; // Fallback to file type
  }

  return generateId(label, uri, tab.group.viewColumn, tabType);
}
