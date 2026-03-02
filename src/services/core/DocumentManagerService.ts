import * as vscode from 'vscode';
import type { 
  DocumentModel, 
  VersionMetadata,
  CreateDocumentModelOptions,
  RegisterVersionOptions,
  VersionSearchResult 
} from '../../models/DocumentModel';
import {
  createDocumentModel,
  registerVersion,
  getVersion,
  getVersionsByType,
  getActiveVersion,
  setActiveVersion,
  removeVersion,
  updateVersionStats,
  associateVariant,
  dissociateVariant,
  getAggregatedStats,
  canBeCleanedUp,
  touchDocument,
  getDocumentSummary,
} from '../../models/DocumentModel';
import type { DiffType, DiffStats } from '../../models/Bay';
import type { BayStateService } from './BayStateService';
import { Logger } from '../../utils/logger';

/**
 * Configuración del DocumentManagerService.
 */
export type DocumentManagerConfig = {
  /** Auto-limpiar documentos sin tabs asociadas (default: true) */
  autoCleanup: boolean;
  /** Tiempo de inactividad antes de limpieza en ms (default: 5 minutos) */
  cleanupTimeout: number;
  /** Máximo número de documentos en caché (default: 100) */
  maxCachedDocuments: number;
  /** Persistir snapshots aunque no haya tabs (default: true) */
  persistSnapshots: boolean;
};

/**
 * Servicio de gestión de DocumentModels.
 * 
 * Responsabilidades:
 * - Crear y gestionar ciclo de vida de DocumentModels
 * - Mantener registro de documentos por URI
 * - Registrar versiones (diffs) de documentos
 * - Sincronizar con SideTabs (bidireccional)
 * - Cleanup automático de documentos inactivos
 * - Proveer API para consultar metadata de documentos/versiones
 * 
 * @remarks
 * Este servicio es la fuente de verdad para metadata de documentos.
 * SideTab mantiene solo referencias (documentModelId) y datos visuales.
 * 
 * Patrón de uso:
 * 1. TabSyncService detecta nuevo documento/diff
 * 2. Llama a DocumentManagerService.getOrCreateDocument()
 * 3. Registra versiones con registerDocumentVersion()
 * 4. BayHierarchyService consulta stats via getDocumentStats()
 * 5. UI consulta metadata via getDocument()
 * 
 * @see DocumentModel for data structure
 * @see TabSyncService for integration
 */
export class DocumentManagerService {
  private documents: Map<string, DocumentModel> = new Map();
  private cleanupTimers: Map<string, NodeJS.Timeout> = new Map();
  private config: DocumentManagerConfig;
  
  constructor(
    private tabStateService: BayStateService,
    config?: Partial<DocumentManagerConfig>
  ) {
    this.config = {
      autoCleanup: config?.autoCleanup ?? true,
      cleanupTimeout: config?.cleanupTimeout ?? 5 * 60 * 1000, // 5 minutes
      maxCachedDocuments: config?.maxCachedDocuments ?? 100,
      persistSnapshots: config?.persistSnapshots ?? true,
    };
    
    Logger.log(`[DocumentManager] Initialized with config: ${JSON.stringify(this.config)}`);
  }
  
  /**
   * Obtiene un documento por su URI base.
   * 
   * @param baseUri URI del documento
   * @returns DocumentModel o undefined
   */
  getDocument(baseUri: vscode.Uri): DocumentModel | undefined {
    const key = this.normalizeUri(baseUri);
    const document = this.documents.get(key);
    
    if (document) {
      touchDocument(document);
      this.resetCleanupTimer(key);
    }
    
    return document;
  }
  
  /**
   * Obtiene un documento por su ID.
   * 
   * @param documentId ID del documento
   * @returns DocumentModel o undefined
   */
  getDocumentById(documentId: string): DocumentModel | undefined {
    return Array.from(this.documents.values())
      .find(doc => doc.documentId === documentId);
  }
  
  /**
   * Obtiene todos los documentos gestionados.
   * 
   * @returns Array de DocumentModels
   */
  getAllDocuments(): DocumentModel[] {
    return Array.from(this.documents.values());
  }
  
  /**
   * Crea un nuevo documento o retorna el existente.
   * 
   * @param options Opciones de creación
   * @returns DocumentModel (nuevo o existente)
   */
  getOrCreateDocument(options: CreateDocumentModelOptions): DocumentModel {
    const key = this.normalizeUri(options.baseUri);
    let document = this.documents.get(key);
    
    if (document) {
      // Update references if needed
      if (options.parentBayId && !document.parentBayId) {
        document.parentBayId = options.parentBayId;
      }
      
      touchDocument(document);
      this.resetCleanupTimer(key);
      
      Logger.log(`[DocumentManager] Retrieved existing document: ${document.fileName}`);
      return document;
    }
    
    // Create new document
    document = createDocumentModel(options);
    this.documents.set(key, document);
    
    // Check cache size
    this.enforceMaxCacheSize();
    
    Logger.log(`[DocumentManager] Created new document: ${document.fileName} (id: ${document.documentId})`);
    
    return document;
  }
  
  /**
   * Registra una nueva versión (diff) en un documento.
   * 
   * @param baseUri URI base del documento
   * @param options Opciones de la versión
   * @returns ID de la versión creada, o undefined si no se encuentra el documento
   */
  registerDocumentVersion(
    baseUri: vscode.Uri,
    options: RegisterVersionOptions
  ): string | undefined {
    const document = this.getDocument(baseUri);
    if (!document) {
      Logger.log(`[DocumentManager] Cannot register version: document not found for ${baseUri.toString()}`);
      return undefined;
    }
    
    const versionId = registerVersion(document, options);
    
    // Associate with child bay if provided
    if (options.relatedBayId) {
      associateVariant(document, options.relatedBayId);
      
      // Update version with bay reference
      const version = getVersion(document, versionId);
      if (version) {
        version.relatedBayId = options.relatedBayId;
      }
    }
    
    Logger.log(`[DocumentManager] Registered version ${options.diffType} for ${document.fileName} (versionId: ${versionId})`);
    
    return versionId;
  }
  
  /**
   * Actualiza las estadísticas de una versión.
   * 
   * @param baseUri URI base del documento
   * @param versionId ID de la versión
   * @param stats Nuevas estadísticas
   * @returns true si se actualizó correctamente
   */
  updateVersionStats(
    baseUri: vscode.Uri,
    versionId: string,
    stats: DiffStats
  ): boolean {
    const document = this.getDocument(baseUri);
    if (!document) {
      return false;
    }
    
    return updateVersionStats(document, versionId, stats);
  }
  
  /**
   * Obtiene todas las versiones de un documento.
   * 
   * @param baseUri URI base del documento
   * @returns Array de VersionMetadata
   */
  getDocumentVersions(baseUri: vscode.Uri): VersionMetadata[] {
    const document = this.getDocument(baseUri);
    if (!document) {
      return [];
    }
    
    return Array.from(document.versions.values());
  }
  
  /**
   * Obtiene versiones de un tipo específico.
   * 
   * @param baseUri URI base del documento
   * @param diffType Tipo de diff a filtrar
   * @returns Array de VersionMetadata
   */
  getDocumentVersionsByType(
    baseUri: vscode.Uri,
    diffType: DiffType
  ): VersionMetadata[] {
    const document = this.getDocument(baseUri);
    if (!document) {
      return [];
    }
    
    return getVersionsByType(document, diffType);
  }
  
  /**
   * Obtiene la versión activa de un documento.
   * 
   * @param baseUri URI base del documento
   * @returns VersionMetadata activa o undefined
   */
  getActiveDocumentVersion(baseUri: vscode.Uri): VersionMetadata | undefined {
    const document = this.getDocument(baseUri);
    if (!document) {
      return undefined;
    }
    
    return getActiveVersion(document);
  }
  
  /**
   * Activa una versión específica de un documento.
   * 
   * @param baseUri URI base del documento
   * @param versionId ID de la versión a activar
   * @returns true si se activó correctamente
   */
  activateVersion(baseUri: vscode.Uri, versionId: string): boolean {
    const document = this.getDocument(baseUri);
    if (!document) {
      return false;
    }
    
    const success = setActiveVersion(document, versionId);
    
    if (success) {
      Logger.log(`[DocumentManager] Activated version ${versionId} for ${document.fileName}`);
    }
    
    return success;
  }
  
  /**
   * Elimina una versión de un documento.
   * 
   * @param baseUri URI base del documento
   * @param versionId ID de la versión a eliminar
   * @returns true si se eliminó correctamente
   */
  removeDocumentVersion(baseUri: vscode.Uri, versionId: string): boolean {
    const document = this.getDocument(baseUri);
    if (!document) {
      return false;
    }
    
    // Get version to unlink bay
    const version = getVersion(document, versionId);
    if (version?.relatedBayId) {
      dissociateVariant(document, version.relatedBayId);
    }
    
    const success = removeVersion(document, versionId);
    
    if (success) {
      Logger.log(`[DocumentManager] Removed version ${versionId} from ${document.fileName}`);
      
      // Schedule cleanup if no more versions
      if (document.versionCount === 0 && this.shouldCleanup(document)) {
        this.scheduleCleanup(this.normalizeUri(document.baseUri));
      }
    }
    
    return success;
  }
  
  /**
   * Asocia un parent bay con un documento.
   * 
   * @param baseUri URI base del documento
   * @param parentTabId ID del parent bay
   */
  associateParentTab(baseUri: vscode.Uri, parentTabId: string): void {
    const document = this.getDocument(baseUri);
    if (!document) {
      return;
    }
    
    document.parentBayId = parentTabId;
    this.resetCleanupTimer(this.normalizeUri(baseUri));
    
    Logger.log(`[DocumentManager] Associated parent bay ${parentTabId} with ${document.fileName}`);
  }
  
  /**
   * Desasocia un parent bay de un documento.
   * 
   * @param baseUri URI base del documento
   */
  dissociateParentBay(baseUri: vscode.Uri): void {
    const document = this.getDocument(baseUri);
    if (!document) {
      return;
    }
    
    document.parentBayId = undefined;
    
    Logger.log(`[DocumentManager] Dissociated parent bay from ${document.fileName}`);
    
    // Schedule cleanup if no more bays
    if (this.shouldCleanup(document)) {
      this.scheduleCleanup(this.normalizeUri(baseUri));
    }
  }
  
  /**
   * Asocia una child bay con un documento.
   * 
   * @param baseUri URI base del documento
   * @param variantId ID de la variant
   */
  associateChildTab(baseUri: vscode.Uri, childTabId: string): void {
    const document = this.getDocument(baseUri);
    if (!document) {
      return;
    }
    
    associateVariant(document, childTabId);
    this.resetCleanupTimer(this.normalizeUri(baseUri));
    
    Logger.log(`[DocumentManager] Associated child bay ${childTabId} with ${document.fileName}`);
  }
  
  /**
   * Desasocia una child bay de un documento.
   * 
   * @param baseUri URI base del documento
   * @param variantId ID de la variant
   */
  dissociateVariant(baseUri: vscode.Uri, variantId: string): void {
    const document = this.getDocument(baseUri);
    if (!document) {
      return;
    }
    
    dissociateVariant(document, variantId);
    
    Logger.log(`[DocumentManager] Dissociated child bay ${variantId} from ${document.fileName}`);
    
    // Schedule cleanup if no more bays
    if (this.shouldCleanup(document)) {
      this.scheduleCleanup(this.normalizeUri(baseUri));
    }
  }
  
  /**
   * Obtiene estadísticas agregadas de un documento.
   * 
   * @param baseUri URI base del documento
   * @returns Objeto con estadísticas o undefined
   */
  getDocumentStats(baseUri: vscode.Uri): ReturnType<typeof getAggregatedStats> | undefined {
    const document = this.getDocument(baseUri);
    if (!document) {
      return undefined;
    }
    
    return getAggregatedStats(document);
  }
  
  /**
   * Busca versiones que coincidan con un criterio.
   * 
   * @param predicate Función de filtrado
   * @returns Array de resultados con versión, documento y score
   */
  searchVersions(
    predicate: (version: VersionMetadata, document: DocumentModel) => boolean
  ): VersionSearchResult[] {
    const results: VersionSearchResult[] = [];
    
    for (const document of this.documents.values()) {
      for (const version of document.versions.values()) {
        if (predicate(version, document)) {
          results.push({
            version,
            document,
            relevanceScore: 1.0, // Could implement scoring
          });
        }
      }
    }
    
    return results;
  }
  
  /**
   * Elimina un documento del registro.
   * 
   * @param baseUri URI base del documento
   * @returns true si se eliminó
   */
  removeDocument(baseUri: vscode.Uri): boolean {
    const key = this.normalizeUri(baseUri);
    const removed = this.documents.delete(key);
    
    if (removed) {
      this.clearCleanupTimer(key);
      Logger.log(`[DocumentManager] Removed document: ${key}`);
    }
    
    return removed;
  }
  
  /**
   * Limpia todos los documentos que cumplen condiciones de cleanup.
   */
  cleanupInactiveDocuments(): void {
    const toRemove: string[] = [];
    
    for (const [key, document] of this.documents.entries()) {
      if (this.shouldCleanup(document)) {
        const timeSinceAccess = Date.now() - document.lastAccessedAt;
        if (timeSinceAccess > this.config.cleanupTimeout) {
          toRemove.push(key);
        }
      }
    }
    
    for (const key of toRemove) {
      this.documents.delete(key);
      this.clearCleanupTimer(key);
    }
    
    if (toRemove.length > 0) {
      Logger.log(`[DocumentManager] Cleaned up ${toRemove.length} inactive documents`);
    }
  }
  
  /**
   * Obtiene un resumen de un documento para debugging.
   * 
   * @param baseUri URI base del documento
   * @returns String con información del documento
   */
  getDocumentSummary(baseUri: vscode.Uri): string | undefined {
    const document = this.getDocument(baseUri);
    if (!document) {
      return undefined;
    }
    
    return getDocumentSummary(document);
  }
  
  /**
   * Normaliza un URI para usarlo como clave en el Map.
   * 
   * @param uri URI a normalizar
   * @returns String normalizado
   */
  private normalizeUri(uri: vscode.Uri): string {
    return uri.toString().toLowerCase();
  }
  
  /**
   * Determina si un documento debe ser limpiado.
   * 
   * @param document DocumentModel
   * @returns true si puede ser limpiado
   */
  private shouldCleanup(document: DocumentModel): boolean {
    if (!this.config.autoCleanup) {
      return false;
    }
    
    // Keep if has associated tabs
    if (!canBeCleanedUp(document)) {
      return false;
    }
    
    // Keep snapshots if configured
    if (this.config.persistSnapshots && document.snapshotHistory.length > 0) {
      return false;
    }
    
    return true;
  }
  
  /**
   * Programa la limpieza automática de un documento.
   * 
   * @param key Clave del documento
   */
  private scheduleCleanup(key: string): void {
    if (!this.config.autoCleanup) {
      return;
    }
    
    // Clear existing timer
    this.clearCleanupTimer(key);
    
    // Schedule new cleanup
    const timer = setTimeout(() => {
      const document = this.documents.get(key);
      if (document && this.shouldCleanup(document)) {
        this.documents.delete(key);
        Logger.log(`[DocumentManager] Auto-cleaned document: ${key}`);
      }
    }, this.config.cleanupTimeout);
    
    this.cleanupTimers.set(key, timer);
  }
  
  /**
   * Resetea el timer de limpieza de un documento.
   * 
   * @param key Clave del documento
   */
  private resetCleanupTimer(key: string): void {
    this.clearCleanupTimer(key);
  }
  
  /**
   * Limpia el timer de limpieza de un documento.
   * 
   * @param key Clave del documento
   */
  private clearCleanupTimer(key: string): void {
    const timer = this.cleanupTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.cleanupTimers.delete(key);
    }
  }
  
  /**
   * Fuerza el cumplimiento del tamaño máximo de caché.
   * Elimina documentos menos recientemente usados.
   */
  private enforceMaxCacheSize(): void {
    if (this.documents.size <= this.config.maxCachedDocuments) {
      return;
    }
    
    // Sort by last accessed (oldest first)
    const sorted = Array.from(this.documents.entries())
      .sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt);
    
    // Remove oldest until under limit
    const toRemove = sorted.length - this.config.maxCachedDocuments;
    for (let i = 0; i < toRemove; i++) {
      const [key, document] = sorted[i];
      if (this.shouldCleanup(document)) {
        this.documents.delete(key);
        this.clearCleanupTimer(key);
      }
    }
    
    Logger.log(`[DocumentManager] Enforced cache size: removed ${toRemove} documents`);
  }
  
  /**
   * Limpia todos los recursos del servicio.
   */
  dispose(): void {
    // Clear all cleanup timers
    for (const timer of this.cleanupTimers.values()) {
      clearTimeout(timer);
    }
    this.cleanupTimers.clear();
    
    // Clear all documents
    this.documents.clear();
    
    Logger.log(`[DocumentManager] Disposed`);
  }
}
