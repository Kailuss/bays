import * as vscode from 'vscode';
import type { DiffType, DiffStats } from '../../models/SideTab';
import type {
  DocumentModel,
  VersionMetadata,
  CreateDocumentModelOptions,
  RegisterVersionOptions,
} from '../../models/DocumentModel';
import {
  createDocumentModel,
  registerVersion,
  getVersion,
  getVersionsByType,
  getActiveVersion,
  setActiveVersion,
  removeVersion,
  associateChildTab,
  dissociateChildTab,
  canBeCleanedUp,
  touchDocument,
  getAggregatedStats,
  getDocumentSummary,
} from '../../models/DocumentModel';
import { Logger } from '../../utils/logger';

/**
 * Opciones de configuración para DocumentManager.
 */
export type DocumentManagerOptions = {
  /**
   * Habilita limpieza automática de documentos sin tabs asociadas.
   * @default true
   */
  autoCleanup?: boolean;
  
  /**
   * Intervalo de limpieza en milisegundos.
   * @default 300000 (5 minutos)
   */
  cleanupInterval?: number;
  
  /**
   * Tiempo de inactividad antes de considerar un documento para limpieza (ms).
   * @default 600000 (10 minutos)
   */
  inactivityThreshold?: number;
};

/**
 * Servicio de gestión centralizada de DocumentModels.
 * 
 * Responsabilidades:
 * - Crear y mantener el ciclo de vida de DocumentModels
 * - Gestionar versiones (diffs) asociadas a cada documento
 * - Asociar/desasociar tabs (parent y children) con documentos
 * - Proporcionar búsqueda y consulta de documentos y versiones
 * - Limpieza automática de documentos huérfanos
 * 
 * @remarks
 * Este servicio es la fuente de verdad para metadata de documentos.
 * BayStateService y TabSyncService delegan la gestión de documentos aquí.
 * 
 * @see DocumentModel for data structure
 * @see BayStateService for tab state management
 */
export class DocumentManager {
  private documents = new Map<string, DocumentModel>();
  private uriToDocIdMap = new Map<string, string>();
  private cleanupTimer?: NodeJS.Timeout;
  
  private readonly autoCleanup: boolean;
  private readonly cleanupInterval: number;
  private readonly inactivityThreshold: number;
  
  constructor(options: DocumentManagerOptions = {}) {
    this.autoCleanup = options.autoCleanup ?? true;
    this.cleanupInterval = options.cleanupInterval ?? 300000; // 5 minutes
    this.inactivityThreshold = options.inactivityThreshold ?? 600000; // 10 minutes
    
    if (this.autoCleanup) {
      this.startAutoCleanup();
    }
  }
  
  // ═══════════════════════════════════════════════════════════════
  // DOCUMENT LIFECYCLE
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Crea un nuevo DocumentModel y lo registra.
   * Si ya existe un documento para la URI, lo retorna.
   * 
   * @param options Opciones de creación
   * @returns DocumentModel creado o existente
   */
  public createDocument(options: CreateDocumentModelOptions): DocumentModel {
    const uriKey = options.baseUri.toString();
    const existingDocId = this.uriToDocIdMap.get(uriKey);
    
    if (existingDocId) {
      const existing = this.documents.get(existingDocId);
      if (existing) {
        touchDocument(existing);
        return existing;
      }
    }
    
    const document = createDocumentModel(options);
    this.documents.set(document.documentId, document);
    this.uriToDocIdMap.set(uriKey, document.documentId);
    
    Logger.log(`DocumentManager: Created document ${document.fileName} (${document.documentId})`);
    
    return document;
  }
  
  /**
   * Obtiene un documento por su ID.
   * 
   * @param documentId ID del documento
   * @returns DocumentModel o undefined
   */
  public getDocument(documentId: string): DocumentModel | undefined {
    const document = this.documents.get(documentId);
    if (document) {
      touchDocument(document);
    }
    return document;
  }
  
  /**
   * Obtiene un documento por su URI base.
   * 
   * @param uri URI del documento
   * @returns DocumentModel o undefined
   */
  public getDocumentByUri(uri: vscode.Uri): DocumentModel | undefined {
    const uriKey = uri.toString();
    const docId = this.uriToDocIdMap.get(uriKey);
    return docId ? this.getDocument(docId) : undefined;
  }
  
  /**
   * Obtiene o crea un documento para una URI.
   * 
   * @param uri URI del documento
   * @param languageId ID del lenguaje
   * @param fileName Nombre del archivo
   * @param fileExtension Extensión del archivo
   * @returns DocumentModel
   */
  public getOrCreateDocument(
    uri: vscode.Uri,
    languageId: string,
    fileName: string,
    fileExtension: string
  ): DocumentModel {
    const existing = this.getDocumentByUri(uri);
    if (existing) {
      return existing;
    }
    
    return this.createDocument({
      baseUri: uri,
      languageId,
      fileName,
      fileExtension,
    });
  }
  
  /**
   * Elimina un documento del gestor.
   * 
   * @param documentId ID del documento
   * @returns true si se eliminó correctamente
   */
  public deleteDocument(documentId: string): boolean {
    const document = this.documents.get(documentId);
    if (!document) {
      return false;
    }
    
    const uriKey = document.baseUri.toString();
    this.uriToDocIdMap.delete(uriKey);
    this.documents.delete(documentId);
    
    Logger.log(`DocumentManager: Deleted document ${document.fileName} (${documentId})`);
    
    return true;
  }
  
  /**
   * Obtiene todos los documentos.
   * 
   * @returns Array de DocumentModel
   */
  public getAllDocuments(): DocumentModel[] {
    return Array.from(this.documents.values());
  }
  
  /**
   * Obtiene el número total de documentos gestionados.
   * 
   * @returns Número de documentos
   */
  public getDocumentCount(): number {
    return this.documents.size;
  }
  
  // ═══════════════════════════════════════════════════════════════
  // VERSION MANAGEMENT
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Registra una nueva versión en un documento.
   * 
   * @param documentId ID del documento
   * @param options Opciones de la versión
   * @returns ID de la versión creada, o undefined si el documento no existe
   */
  public registerVersion(
    documentId: string,
    options: RegisterVersionOptions
  ): string | undefined {
    const document = this.getDocument(documentId);
    if (!document) {
      return undefined;
    }
    
    return registerVersion(document, options);
  }
  
  /**
   * Obtiene una versión específica.
   * 
   * @param documentId ID del documento
   * @param versionId ID de la versión
   * @returns VersionMetadata o undefined
   */
  public getVersion(
    documentId: string,
    versionId: string
  ): VersionMetadata | undefined {
    const document = this.getDocument(documentId);
    return document ? getVersion(document, versionId) : undefined;
  }
  
  /**
   * Obtiene todas las versiones de un tipo específico.
   * 
   * @param documentId ID del documento
   * @param diffType Tipo de diff
   * @returns Array de VersionMetadata
   */
  public getVersionsByType(
    documentId: string,
    diffType: DiffType
  ): VersionMetadata[] {
    const document = this.getDocument(documentId);
    return document ? getVersionsByType(document, diffType) : [];
  }
  
  /**
   * Obtiene la versión activa de un documento.
   * 
   * @param documentId ID del documento
   * @returns VersionMetadata activa o undefined
   */
  public getActiveVersion(documentId: string): VersionMetadata | undefined {
    const document = this.getDocument(documentId);
    return document ? getActiveVersion(document) : undefined;
  }
  
  /**
   * Marca una versión como activa.
   * 
   * @param documentId ID del documento
   * @param versionId ID de la versión
   * @returns true si se activó correctamente
   */
  public setActiveVersion(documentId: string, versionId: string): boolean {
    const document = this.getDocument(documentId);
    return document ? setActiveVersion(document, versionId) : false;
  }
  
  /**
   * Elimina una versión de un documento.
   * 
   * @param documentId ID del documento
   * @param versionId ID de la versión
   * @returns true si se eliminó correctamente
   */
  public removeVersion(documentId: string, versionId: string): boolean {
    const document = this.getDocument(documentId);
    return document ? removeVersion(document, versionId) : false;
  }
  
  /**
   * Obtiene todas las versiones de un documento.
   * 
   * @param documentId ID del documento
   * @returns Array de VersionMetadata
   */
  public getAllVersions(documentId: string): VersionMetadata[] {
    const document = this.getDocument(documentId);
    return document ? Array.from(document.versions.values()) : [];
  }
  
  // ═══════════════════════════════════════════════════════════════
  // TAB ASSOCIATIONS
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Asocia un parent tab con un documento.
   * 
   * @param documentId ID del documento
   * @param parentTabId ID del parent tab
   * @returns true si se asoció correctamente
   */
  public associateParentTab(documentId: string, parentTabId: string): boolean {
    const document = this.getDocument(documentId);
    if (!document) {
      return false;
    }
    
    document.parentTabId = parentTabId;
    return true;
  }
  
  /**
   * Desasocia el parent tab de un documento.
   * 
   * @param documentId ID del documento
   * @returns true si se desasociócorrectamente
   */
  public dissociateParentTab(documentId: string): boolean {
    const document = this.getDocument(documentId);
    if (!document) {
      return false;
    }
    
    document.parentTabId = undefined;
    return true;
  }
  
  /**
   * Asocia un child tab con un documento.
   * 
   * @param documentId ID del documento
   * @param childTabId ID del child tab
   * @returns true si se asoció correctamente
   */
  public associateChildTab(documentId: string, childTabId: string): boolean {
    const document = this.getDocument(documentId);
    if (!document) {
      return false;
    }
    
    associateChildTab(document, childTabId);
    return true;
  }
  
  /**
   * Desasocia un child tab de un documento.
   * 
   * @param documentId ID del documento
   * @param childTabId ID del child tab
   * @returns true si se desasociό correctamente
   */
  public dissociateChildTab(documentId: string, childTabId: string): boolean {
    const document = this.getDocument(documentId);
    if (!document) {
      return false;
    }
    
    dissociateChildTab(document, childTabId);
    return true;
  }
  
  /**
   * Obtiene el documento asociado a un parent tab.
   * 
   * @param parentTabId ID del parent tab
   * @returns DocumentModel o undefined
   */
  public getDocumentByParentTab(parentTabId: string): DocumentModel | undefined {
    return Array.from(this.documents.values()).find(
      doc => doc.parentTabId === parentTabId
    );
  }
  
  /**
   * Obtiene todos los documentos que tienen un child tab específica.
   * 
   * @param childTabId ID del child tab
   * @returns Array de DocumentModel
   */
  public getDocumentsByChildTab(childTabId: string): DocumentModel[] {
    return Array.from(this.documents.values()).filter(
      doc => doc.childTabIds.has(childTabId)
    );
  }
  
  // ═══════════════════════════════════════════════════════════════
  // SEARCH & QUERY
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Busca documentos por nombre de archivo (insensible a mayúsculas).
   * 
   * @param query Consulta de búsqueda
   * @returns Array de DocumentModel
   */
  public searchByFileName(query: string): DocumentModel[] {
    const lowerQuery = query.toLowerCase();
    return Array.from(this.documents.values()).filter(
      doc => doc.fileName.toLowerCase().includes(lowerQuery)
    );
  }
  
  /**
   * Filtra documentos por lenguaje.
   * 
   * @param languageId ID del lenguaje
   * @returns Array de DocumentModel
   */
  public filterByLanguage(languageId: string): DocumentModel[] {
    return Array.from(this.documents.values()).filter(
      doc => doc.languageId === languageId
    );
  }
  
  /**
   * Obtiene documentos que tienen cambios sin guardar.
   * 
   * @returns Array de DocumentModel
   */
  public getDocumentsWithUnsavedChanges(): DocumentModel[] {
    return Array.from(this.documents.values()).filter(
      doc => doc.hasUnsavedChanges
    );
  }
  
  /**
   * Obtiene documentos modificados en un rango de tiempo.
   * 
   * @param since Timestamp de inicio
   * @param until Timestamp de fin (por defecto: ahora)
   * @returns Array de DocumentModel
   */
  public getDocumentsModifiedInRange(
    since: number,
    until: number = Date.now()
  ): DocumentModel[] {
    return Array.from(this.documents.values()).filter(
      doc => doc.lastModifiedAt >= since && doc.lastModifiedAt <= until
    );
  }
  
  /**
   * Busca versiones por tipo en todos los documentos.
   * 
   * @param diffType Tipo de diff
   * @returns Array de objetos con documento y versión
   */
  public searchVersionsByType(diffType: DiffType): Array<{
    document: DocumentModel;
    version: VersionMetadata;
  }> {
    const results: Array<{ document: DocumentModel; version: VersionMetadata }> = [];
    
    for (const document of this.documents.values()) {
      const versions = getVersionsByType(document, diffType);
      for (const version of versions) {
        results.push({ document, version });
      }
    }
    
    return results;
  }
  
  // ═══════════════════════════════════════════════════════════════
  // STATISTICS & REPORTING
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Obtiene estadísticas agregadas de un documento.
   * 
   * @param documentId ID del documento
   * @returns Objeto con estadísticas o undefined
   */
  public getDocumentStats(documentId: string): ReturnType<typeof getAggregatedStats> | undefined {
    const document = this.getDocument(documentId);
    return document ? getAggregatedStats(document) : undefined;
  }
  
  /**
   * Obtiene un resumen legible de un documento.
   * 
   * @param documentId ID del documento
   * @returns String con resumen o undefined
   */
  public getDocumentSummary(documentId: string): string | undefined {
    const document = this.getDocument(documentId);
    return document ? getDocumentSummary(document) : undefined;
  }
  
  /**
   * Obtiene estadísticas globales del gestor.
   * 
   * @returns Objeto con estadísticas globales
   */
  public getGlobalStats(): {
    totalDocuments: number;
    totalVersions: number;
    documentsWithChanges: number;
    orphanedDocuments: number;
    totalChildTabs: number;
    languageDistribution: Map<string, number>;
  } {
    const docs = Array.from(this.documents.values());
    const languageDistribution = new Map<string, number>();
    
    let totalVersions = 0;
    let totalChildTabs = 0;
    
    for (const doc of docs) {
      totalVersions += doc.versionCount;
      totalChildTabs += doc.childTabIds.size;
      
      const count = languageDistribution.get(doc.languageId) ?? 0;
      languageDistribution.set(doc.languageId, count + 1);
    }
    
    return {
      totalDocuments: docs.length,
      totalVersions,
      documentsWithChanges: docs.filter(d => d.hasUnsavedChanges).length,
      orphanedDocuments: docs.filter(d => canBeCleanedUp(d)).length,
      totalChildTabs,
      languageDistribution,
    };
  }
  
  // ═══════════════════════════════════════════════════════════════
  // CLEANUP
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Inicia el proceso de limpieza automática.
   * @private
   */
  private startAutoCleanup(): void {
    if (this.cleanupTimer) {
      return;
    }
    
    this.cleanupTimer = setInterval(() => {
      this.performCleanup();
    }, this.cleanupInterval);
    
    Logger.log('DocumentManager: Auto-cleanup started');
  }
  
  /**
   * Detiene el proceso de limpieza automática.
   */
  public stopAutoCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
      Logger.log('DocumentManager: Auto-cleanup stopped');
    }
  }
  
  /**
   * Ejecuta la limpieza de documentos huérfanos e inactivos.
   * 
   * @returns Número de documentos eliminados
   */
  public performCleanup(): number {
    const now = Date.now();
    const toDelete: string[] = [];
    
    for (const [docId, document] of this.documents) {
      if (!canBeCleanedUp(document)) {
        continue;
      }
      
      const inactiveTime = now - document.lastAccessedAt;
      if (inactiveTime >= this.inactivityThreshold) {
        toDelete.push(docId);
      }
    }
    
    for (const docId of toDelete) {
      this.deleteDocument(docId);
    }
    
    if (toDelete.length > 0) {
      Logger.log(`DocumentManager: Cleaned up ${toDelete.length} orphaned documents`);
    }
    
    return toDelete.length;
  }
  
  /**
   * Limpia todas las versiones antiguas según un criterio.
   * 
   * @param maxAge Edad máxima en milisegundos
   * @returns Número de versiones eliminadas
   */
  public cleanupOldVersions(maxAge: number): number {
    const now = Date.now();
    let deletedCount = 0;
    
    for (const document of this.documents.values()) {
      const versionsToDelete: string[] = [];
      
      for (const [versionId, version] of document.versions) {
        const age = now - version.createdAt;
        if (age >= maxAge && !version.isActive) {
          versionsToDelete.push(versionId);
        }
      }
      
      for (const versionId of versionsToDelete) {
        removeVersion(document, versionId);
        deletedCount++;
      }
    }
    
    if (deletedCount > 0) {
      Logger.log(`DocumentManager: Cleaned up ${deletedCount} old versions`);
    }
    
    return deletedCount;
  }
  
  /**
   * Limpia todo el estado del gestor.
   */
  public clear(): void {
    this.stopAutoCleanup();
    this.documents.clear();
    this.uriToDocIdMap.clear();
    Logger.log('DocumentManager: Cleared all documents');
  }
  
  /**
   * Dispose del gestor y libera recursos.
   */
  public dispose(): void {
    this.clear();
  }
}
