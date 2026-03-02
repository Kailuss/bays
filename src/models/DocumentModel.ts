import * as vscode from 'vscode';
import type { DiffType, DiffStats } from './Bay';

/**
 * Metadata de una versión específica del documento.
 * Representa un diff, snapshot o estado del documento.
 */
export type VersionMetadata = {
  //: IDENTITY
  versionId: string;            // Unique identifier for this version
  diffType: DiffType;           // Type of diff/version
  
  //: ORIGIN
  originalUri?: vscode.Uri;     // Original file URI (left side of diff)
  modifiedUri?: vscode.Uri;     // Modified file URI (right side of diff)
  
  //: STATISTICS
  stats?: DiffStats;            // Diff statistics (lines added/removed, etc.)
  
  //: TEMPORAL
  createdAt: number;            // When this version was created (timestamp)
  lastAccessedAt: number;       // Last time this version was viewed
  
  //: DISPLAY
  label: string;                // Display label for this version
  description?: string;         // Additional description
  
  //: GIT/VCS (if applicable)
  commitHash?: string;          // Git commit hash (for commit diffs)
  branch?: string;              // Branch name (for branch comparisons)
  
  //: AI/COPILOT (if applicable)
  aiMetadata?: {
    prompt?: string;            // AI prompt used (for Copilot edits)
    model?: string;             // AI model identifier
    confidence?: number;        // Confidence score 0-1
    editCount?: number;         // Number of edits in this version
  };
  
  //: MERGE CONFLICTS (if applicable)
  conflictMetadata?: {
    conflictSections: number;   // Number of conflict markers
    incomingBranch?: string;    // Branch with incoming changes
    currentBranch?: string;     // Current branch
  };
  
  //: RELATIONSHIPS
  relatedBayId?: string;        // Bay ID that displays this version
  isActive: boolean;            // Is currently displayed in editor
};

/**
 * Modelo interno de gestión de documento.
 * Representa un documento principal con todas sus versiones/diffs.
 * 
 * @remarks
 * Este modelo es de uso interno en servicios y NO se expone directamente
 * en la webview. Bay mantiene la responsabilidad de representación visual.
 * 
 * Relación con Bay:
 * - Cada Bay parent puede tener un DocumentModel asociado
 * - Cada DocumentVersion referencia a una Variant (si existe)
 * - DocumentModel es la fuente de verdad para metadata de documento
 * 
 * @see Bay for visual representation
 * @see DocumentManager for lifecycle management
 */
export type DocumentModel = {
  //: IDENTITY
  documentId: string;           // Unique identifier (based on base URI)
  baseUri: vscode.Uri;          // Base file URI (the "parent" document)
  
  //: FILE METADATA (shared across versions)
  languageId: string;           // Language identifier
  fileExtension: string;        // File extension with dot
  fileName: string;             // Base filename
  
  //: FILE CHARACTERISTICS
  fileSize?: number;            // File size in bytes
  isReadOnly: boolean;          // Whether file is read-only
  isBinary: boolean;            // Whether file is binary
  encoding?: string;            // File encoding
  
  //: VERSIONS
  versions: Map<string, VersionMetadata>;  // All versions of this document
  activeVersionId?: string;     // Currently active version (if any)
  
  //: TEMPORAL
  createdAt: number;            // When document was first opened
  lastModifiedAt: number;       // Last modification timestamp
  lastAccessedAt: number;       // Last access timestamp
  
  //: RELATIONSHIPS
  parentBayId?: string;         // Associated parent Bay ID
  variantIds: Set<string>;     // Associated variant IDs
  
  //: STATE
  hasUnsavedChanges: boolean;   // Whether document has unsaved changes
  versionCount: number;         // Total number of versions
  
  //: GIT/VCS
  gitMetadata?: {
    branch?: string;            // Current branch
    hasUncommittedChanges: boolean;
    ahead?: number;             // Commits ahead
    behind?: number;            // Commits behind
    lastCommit?: string;        // Last commit hash
  };
  
  //: HISTORY
  snapshotHistory: Array<{      // Historical snapshots
    timestamp: number;
    versionId: string;
    name?: string;
  }>;
  
  //: EXTENSIBILITY
  customData?: Record<string, any>;  // Extension-specific data
};

/**
 * Opciones para crear un DocumentModel.
 */
export type CreateDocumentModelOptions = {
  baseUri: vscode.Uri;
  languageId: string;
  fileName: string;
  fileExtension: string;
  parentBayId?: string;
  fileSize?: number;
  isReadOnly?: boolean;
  isBinary?: boolean;
};

/**
 * Opciones para registrar una nueva versión en un DocumentModel.
 */
export type RegisterVersionOptions = {
  diffType: DiffType;
  originalUri?: vscode.Uri;
  modifiedUri?: vscode.Uri;
  label: string;
  description?: string;
  stats?: DiffStats;
  relatedBayId?: string;
  commitHash?: string;
  branch?: string;
  aiMetadata?: VersionMetadata['aiMetadata'];
  conflictMetadata?: VersionMetadata['conflictMetadata'];
};

/**
 * Resultado de una búsqueda de versiones.
 */
export type VersionSearchResult = {
  version: VersionMetadata;
  document: DocumentModel;
  relevanceScore: number;
};

/**
 * Crea un nuevo DocumentModel con valores por defecto.
 * 
 * @param options Opciones de creación
 * @returns DocumentModel inicializado
 */
export function createDocumentModel(options: CreateDocumentModelOptions): DocumentModel {
  const now = Date.now();
  const documentId = `doc-${options.baseUri.toString()}`;
  
  return {
    documentId,
    baseUri: options.baseUri,
    languageId: options.languageId,
    fileExtension: options.fileExtension,
    fileName: options.fileName,
    fileSize: options.fileSize,
    isReadOnly: options.isReadOnly ?? false,
    isBinary: options.isBinary ?? false,
    versions: new Map(),
    variantIds: new Set(),
    createdAt: now,
    lastModifiedAt: now,
    lastAccessedAt: now,
    hasUnsavedChanges: false,
    versionCount: 0,
    snapshotHistory: [],
    parentBayId: options.parentBayId,
  };
}

/**
 * Registra una nueva versión en un DocumentModel.
 * 
 * @param document DocumentModel donde registrar la versión
 * @param options Opciones de la versión
 * @returns ID de la versión creada
 */
export function registerVersion(
  document: DocumentModel,
  options: RegisterVersionOptions
): string {
  const now = Date.now();
  const versionId = `${document.documentId}-${options.diffType}-${now}`;
  
  const version: VersionMetadata = {
    versionId,
    diffType: options.diffType,
    originalUri: options.originalUri,
    modifiedUri: options.modifiedUri,
    label: options.label,
    description: options.description,
    stats: options.stats,
    createdAt: now,
    lastAccessedAt: now,
    isActive: false,
    relatedBayId: options.relatedBayId,
    commitHash: options.commitHash,
    branch: options.branch,
    aiMetadata: options.aiMetadata,
    conflictMetadata: options.conflictMetadata,
  };
  
  document.versions.set(versionId, version);
  document.versionCount = document.versions.size;
  document.lastModifiedAt = now;
  
  // Track in snapshot history if it's a snapshot type
  if (options.diffType === 'snapshot') {
    document.snapshotHistory.push({
      timestamp: now,
      versionId,
      name: options.stats?.snapshotName,
    });
  }
  
  return versionId;
}

/**
 * Obtiene una versión específica de un documento.
 * 
 * @param document DocumentModel
 * @param versionId ID de la versión
 * @returns VersionMetadata o undefined
 */
export function getVersion(
  document: DocumentModel,
  versionId: string
): VersionMetadata | undefined {
  return document.versions.get(versionId);
}

/**
 * Obtiene todas las versiones de un tipo específico.
 * 
 * @param document DocumentModel
 * @param diffType Tipo de diff a filtrar
 * @returns Array de VersionMetadata
 */
export function getVersionsByType(
  document: DocumentModel,
  diffType: DiffType
): VersionMetadata[] {
  return Array.from(document.versions.values())
    .filter(v => v.diffType === diffType);
}

/**
 * Obtiene la versión activa del documento.
 * 
 * @param document DocumentModel
 * @returns VersionMetadata activa o undefined
 */
export function getActiveVersion(
  document: DocumentModel
): VersionMetadata | undefined {
  if (!document.activeVersionId) {
    return undefined;
  }
  return document.versions.get(document.activeVersionId);
}

/**
 * Marca una versión como activa (desactivando las demás).
 * 
 * @param document DocumentModel
 * @param versionId ID de la versión a activar
 * @returns true si se activó correctamente
 */
export function setActiveVersion(
  document: DocumentModel,
  versionId: string
): boolean {
  const version = document.versions.get(versionId);
  if (!version) {
    return false;
  }
  
  // Deactivate all versions
  document.versions.forEach(v => v.isActive = false);
  
  // Activate target version
  version.isActive = true;
  version.lastAccessedAt = Date.now();
  document.activeVersionId = versionId;
  document.lastAccessedAt = Date.now();
  
  return true;
}

/**
 * Elimina una versión del documento.
 * 
 * @param document DocumentModel
 * @param versionId ID de la versión a eliminar
 * @returns true si se eliminó correctamente
 */
export function removeVersion(
  document: DocumentModel,
  versionId: string
): boolean {
  const deleted = document.versions.delete(versionId);
  
  if (deleted) {
    document.versionCount = document.versions.size;
    document.lastModifiedAt = Date.now();
    
    // Clear active version if it was the deleted one
    if (document.activeVersionId === versionId) {
      document.activeVersionId = undefined;
    }
    
    // Remove from snapshot history if present
    const historyIndex = document.snapshotHistory.findIndex(
      s => s.versionId === versionId
    );
    if (historyIndex !== -1) {
      document.snapshotHistory.splice(historyIndex, 1);
    }
  }
  
  return deleted;
}

/**
 * Actualiza las estadísticas de una versión.
 * 
 * @param document DocumentModel
 * @param versionId ID de la versión
 * @param stats Nuevas estadísticas
 * @returns true si se actualizó correctamente
 */
export function updateVersionStats(
  document: DocumentModel,
  versionId: string,
  stats: DiffStats
): boolean {
  const version = document.versions.get(versionId);
  if (!version) {
    return false;
  }
  
  version.stats = { ...version.stats, ...stats };
  document.lastModifiedAt = Date.now();
  
  return true;
}

/**
 * Asocia una variante con un documento.
 * 
 * @param document DocumentModel
 * @param variantId ID de la variante
 */
export function associateVariant(
  document: DocumentModel,
  variantId: string
): void {
  document.variantIds.add(variantId);
}

/**
 * Desasocia una variante de un documento.
 * 
 * @param document DocumentModel
 * @param variantId ID de la variante
 */
export function dissociateVariant(
  document: DocumentModel,
  variantId: string
): void {
  document.variantIds.delete(variantId);
}

/**
 * Obtiene estadísticas agregadas de todas las versiones.
 * 
 * @param document DocumentModel
 * @returns Objeto con estadísticas resumidas
 */
export function getAggregatedStats(document: DocumentModel): {
  totalVersions: number;
  workingTreeVersions: number;
  stagedVersions: number;
  snapshots: number;
  commits: number;
  aiEdits: number;
  mergeConflicts: number;
  totalLinesAdded: number;
  totalLinesRemoved: number;
  oldestVersion?: number;
  newestVersion?: number;
} {
  const versions = Array.from(document.versions.values());
  
  const stats = {
    totalVersions: versions.length,
    workingTreeVersions: versions.filter(v => v.diffType === 'working-tree').length,
    stagedVersions: versions.filter(v => v.diffType === 'staged').length,
    snapshots: versions.filter(v => v.diffType === 'snapshot').length,
    commits: versions.filter(v => v.diffType === 'commit').length,
    aiEdits: versions.filter(v => v.diffType === 'edit').length,
    mergeConflicts: versions.filter(v => v.diffType === 'merge-conflict').length,
    totalLinesAdded: 0,
    totalLinesRemoved: 0,
    oldestVersion: undefined as number | undefined,
    newestVersion: undefined as number | undefined,
  };
  
  for (const version of versions) {
    if (version.stats?.linesAdded) {
      stats.totalLinesAdded += version.stats.linesAdded;
    }
    if (version.stats?.linesRemoved) {
      stats.totalLinesRemoved += version.stats.linesRemoved;
    }
    
    if (!stats.oldestVersion || version.createdAt < stats.oldestVersion) {
      stats.oldestVersion = version.createdAt;
    }
    if (!stats.newestVersion || version.createdAt > stats.newestVersion) {
      stats.newestVersion = version.createdAt;
    }
  }
  
  return stats;
}

/**
 * Comprueba si el documento necesita limpieza (no tiene bays asociadas).
 * 
 * @param document DocumentModel
 * @returns true si puede ser limpiado
 */
export function canBeCleanedUp(document: DocumentModel): boolean {
  return !document.parentBayId && document.variantIds.size === 0;
}

/**
 * Actualiza el timestamp de último acceso.
 * 
 * @param document DocumentModel
 */
export function touchDocument(document: DocumentModel): void {
  document.lastAccessedAt = Date.now();
}

/**
 * Obtiene un resumen legible del documento para debugging.
 * 
 * @param document DocumentModel
 * @returns String con información del documento
 */
export function getDocumentSummary(document: DocumentModel): string {
  const stats = getAggregatedStats(document);
  return `Document: ${document.fileName} (${document.languageId})
  - Versions: ${stats.totalVersions} (${stats.workingTreeVersions} working-tree, ${stats.stagedVersions} staged, ${stats.snapshots} snapshots)
  - Changes: +${stats.totalLinesAdded} -${stats.totalLinesRemoved}
  - Bays: parent=${document.parentBayId ?? 'none'}, children=${document.variantIds.size}
  - Modified: ${new Date(document.lastModifiedAt).toLocaleString()}`;
}
