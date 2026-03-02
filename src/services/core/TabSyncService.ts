import * as vscode from 'vscode';
import { BayStateService } from './BayStateService';
import { GitSyncService } from '../integration/GitSyncService';
import { BayHierarchyService } from './BayHierarchyService';
import { DocumentManager } from './DocumentManager';
import { BayEventService } from './bay/BayEventService';
import { BayHeadService } from './bay/BayHeadService';
import { ActiveStateService } from './bay/ActiveStateService';
import { SideTab } from '../../models/Bay';
import { createTabGroup } from '../../models/BayGroup';
import { convertToSideTab, getDiagnosticSeverity } from './helpers/tabConverter';
import { Logger } from '../../utils/logger';

/**
 * BaySyncService - Orquestador de Sincronización de Tabs
 * 
 * Mantiene el estado interno de pestañas sincronizado con VS Code.
 * Delega responsabilidades específicas a servicios especializados:
 * - BayEventService: Gestión de eventos de VS Code
 * - BayHeadService: Gestión de parent placeholders y apertura automática
 * - ActiveStateService: Sincronización de estado activo y orphan cleanup
 * 
 * Este servicio actúa como coordinador delgado, no como implementador.
 * 
 * NOTA: Las tabs de Markdown Preview se filtran directamente en convertToSideTab()
 * y se manejan como estado toggle (viewMode) en la tab del archivo fuente.
 * 
 * REFACTORIZACIÓN MARZO 2026: Código modularizado en bay/ folder.
 * @see docs/PLAN_OPTIMIZACION_TABSYNC.md
 * @see src/services/core/AGENT.md#refactoring-march-2026
 */
export class BaySyncService {
  private gitSyncService: GitSyncService;
  private hierarchyService: BayHierarchyService;
  private documentManager: DocumentManager;
  
  // Specialized services (post-refactoring)
  private bayEventService: BayEventService;
  private bayHeadService: BayHeadService;
  private activeStateService: ActiveStateService;
  
  // Map para relacionar IDs de tabs con versionIds únicos del DocumentModel
  // Esto permite rastrear qué version del documento corresponde a cada child tab
  private readonly tabIdToVersionId: Map<string, string> = new Map();

  constructor(private stateService: BayStateService) {
    this.gitSyncService = new GitSyncService(this.stateService);
    this.hierarchyService = new BayHierarchyService(this.stateService);
    this.documentManager = new DocumentManager({
      autoCleanup: true,
      cleanupInterval: 300000, // 5 minutes
      inactivityThreshold: 600000, // 10 minutes
    });
    
    // Initialize specialized services
    this.bayHeadService = new BayHeadService(
      this.stateService,
      this.hierarchyService,
      this.gitSyncService
    );
    
    this.activeStateService = new ActiveStateService(this.stateService);
    
    this.bayEventService = new BayEventService(
      this.stateService,
      this.gitSyncService,
      this.hierarchyService,
      this.bayHeadService,
      this.activeStateService
    );
    
    // Inject services into state service to avoid circular dependencies
    this.stateService.setHierarchyService(this.hierarchyService);
    this.stateService.setDocumentManager(this.documentManager);
  }
  
  /** Get access to the document manager for external use */
  getDocumentManager(): DocumentManager {
    return this.documentManager;
  }

  /** 
   * Registra los listeners necesarios y realiza una sincronización inicial.
   * Resultado: el `BayStateService` queda poblado y listo para la UI.
   * 
   * Delegación:
   * - BayEventService: Registra todos los event listeners de VS Code
   * - GitSyncService: Activa sincronización de estado Git
   * - syncAll(): Realiza sincronización inicial completa
   */
  activate(context: vscode.ExtensionContext): void {
    Logger.log('[BaySync] Activating BaySyncService');
    
    // Initial full sync
    this.syncAll();

    // Delegate event listener registration to BayEventService
    this.bayEventService.activate();

    // Register diagnostic listener (handled directly by BaySyncService)
    context.subscriptions.push(
      vscode.languages.onDidChangeDiagnostics((event) => {
        for (const uri of event.uris) {
          this.updateTabDiagnostics(uri);
        }
      })
    );

    // Activate Git sync service
    this.gitSyncService.activate(context);

    // Register cleanup
    context.subscriptions.push(this);
    
    Logger.log('[BaySync] BaySyncService activated successfully');
  }

  /**
   * Sincronización completa (reconstruir todo el estado).
   * 
   * Flujo:
   * 1. Añadir todos los grupos de editores al estado
   * 2. Primera pasada: Convertir tabs normales (parents y standalone)
   * 3. Segunda pasada: Convertir variants, asegurando la existencia de parents
   * 4. Reemplazar estado completo con las tabs procesadas
   * 5. Recalcular jerarquía de parent-child
   * 
   * Delegación:
   * - BayHeadService.ensureParentExistsForSync(): Asegurar parents para variants
   * - BayHierarchyService.recalculateAllCounts(): Recalcular counts de children
   */
  private async syncAll(): Promise<void> {
    Logger.log('[BaySync] Starting full syncAll');
    
    // Add all editor groups
    for (const group of vscode.window.tabGroups.all) {
      this.stateService.addGroup(createTabGroup(group));
    }

    const allTabs: SideTab[] = [];
    const childTabs: Array<{ sideTab: SideTab; nativeTab: vscode.Tab }> = [];
    
    // First pass: collect all tabs, separating parents from children
    for (const group of vscode.window.tabGroups.all) {
      group.tabs.forEach((tab, idx) => {
        const st = convertToSideTab(tab, this.gitSyncService, idx);
        if (st) {
          if (st.metadata.parentId) {
            // This is a variant tab (diff) - defer it
            childTabs.push({ sideTab: st, nativeTab: tab });
          } else {
            // This is a parent tab or standalone tab - add it immediately
            allTabs.push(st);
          }
        }
      });
    }
    
    // Second pass: process child tabs after parents are loaded
    // Process sequentially to ensure parents are opened before children are added
    for (const { sideTab, nativeTab } of childTabs) {
      // Ensure parent exists (delegate to BayHeadService)
      await this.bayHeadService.ensureParentExistsForSync(sideTab, nativeTab, allTabs);
      allTabs.push(sideTab);
    }
    
    // Replace entire state with processed tabs
    this.stateService.replaceTabs(allTabs);
    
    // Recalculate hierarchy after sync complete
    this.hierarchyService.recalculateAllCounts();
    
    Logger.log(`[BaySync] syncAll complete - ${allTabs.length} tabs loaded`);
  }

  /**
   * Actualiza el estado activo de las tabs cuando cambia el editor activo.
   * Delega a ActiveStateService para la sincronización real.
   * 
   * También sincroniza la posición del cursor si la tab activa pertenece
   * a una familia parent-child.
   */
  private updateActiveTab(activeUri: vscode.Uri): void {
    // Delegate to syncActiveState which reads tab.isActive from the native API
    // This correctly handles the same file open in multiple groups
    const { hasChanges } = this.activeStateService.syncActiveState();
    if (hasChanges) {
      this.stateService.notifyChange();
    }

    // Sync cursor position when activating a tab from the parent-child family
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor && activeEditor.document.uri.toString() === activeUri.toString()) {
      const tab = this.stateService.findTabByUri(activeUri);
      if (tab && (tab.metadata.parentId || tab.state.hasChildren)) {
        // This tab is part of a parent-child family, sync cursor position
        const selection = activeEditor.selection;
        const line = selection.active.line + 1;
        const column = selection.active.character + 1;
        this.hierarchyService.syncCursorPosition(tab.metadata.id, line, column);
      }
    }
  }

  /**
   * Maneja cambios en la posición del cursor (selección).
   * Delega a HierarchyService para sincronización entre parent y variants.
   */
  private handleCursorChange(event: vscode.TextEditorSelectionChangeEvent): void {
    const uri = event.textEditor.document.uri;
    const selection = event.selections[0];
    
    if (!selection) { return; }

    const line = selection.active.line + 1;
    const column = selection.active.character + 1;

    const tab = this.stateService.findTabByUri(uri);
    if (!tab) { return; }

    this.hierarchyService.syncCursorPosition(tab.metadata.id, line, column);
  }

  /**
   * Actualiza los diagnósticos y git status de una pestaña específica cuando cambian.
   */
  private updateTabDiagnostics(uri: vscode.Uri): void {
    const tab = this.stateService.findTabByUri(uri);
    if (!tab) { return; }

    const newDiagnosticSeverity = getDiagnosticSeverity(uri);
    const newGitStatus = this.gitSyncService.getGitStatus(uri);

    if (tab.state.diagnosticSeverity !== newDiagnosticSeverity || 
        tab.state.gitStatus !== newGitStatus) {
      Logger.log(`[BaySync] Updating diagnostics/git for: ${tab.metadata.label}`);
      tab.state.diagnosticSeverity = newDiagnosticSeverity;
      tab.state.gitStatus = newGitStatus;
      this.stateService.updateTabStateWithAnimation(tab);
    }
  }

  /**
   * Asegura que existe un DocumentModel para una tab.
   * Si no existe, lo crea y lo asocia con la tab.
   * 
   * @param tab SideTab para la cual asegurar que existe un documento
   */
  private ensureDocumentExists(tab: SideTab): void {
    if (!tab.metadata.uri) {
      return;
    }

    // Check if document already exists
    const existing = this.documentManager.getDocumentByUri(tab.metadata.uri);
    if (existing) {
      // Associate parent tab if not already associated
      if (!existing.parentTabId) {
        this.documentManager.associateParentTab(existing.documentId, tab.metadata.id);
      }
      return;
    }

    // Create new document
    const document = this.documentManager.createDocument({
      baseUri: tab.metadata.uri,
      languageId: tab.metadata.languageId || 'plaintext',
      fileName: tab.metadata.fileName || 'untitled',
      fileExtension: tab.metadata.fileExtension,
      parentTabId: tab.metadata.id,
      fileSize: tab.metadata.fileSize,
      isReadOnly: tab.metadata.isReadOnly,
      isBinary: tab.metadata.isBinary,
    });

    Logger.log(`[TabSync] Created document for tab: ${tab.metadata.label} (docId: ${document.documentId})`);
  }

  /**
   * Registra una versión (diff) de un documento en el DocumentManager.
   * 
   * @param childTab Child tab que representa la versión
   * @param parentTab Parent tab del documento base
   */
  private registerTabVersion(childTab: SideTab, parentTab: SideTab): void {
    if (!parentTab.metadata.uri || !childTab.metadata.diffType) {
      return;
    }

    // Get or create the document
    const document = this.documentManager.getOrCreateDocument(
      parentTab.metadata.uri,
      parentTab.metadata.languageId || 'plaintext',
      parentTab.metadata.fileName || 'untitled',
      parentTab.metadata.fileExtension
    );

    // Associate parent if not already
    if (!document.parentTabId) {
      this.documentManager.associateParentTab(document.documentId, parentTab.metadata.id);
    }

    // Register the version
    const versionId = this.documentManager.registerVersion(document.documentId, {
      diffType: childTab.metadata.diffType,
      originalUri: childTab.metadata.originalUri,
      modifiedUri: childTab.metadata.uri,
      label: childTab.metadata.label,
      description: childTab.metadata.detailLabel,
      stats: childTab.state.diffStats,
      relatedTabId: childTab.metadata.id,
    });

    if (versionId) {
      // Associate child tab with document
      this.documentManager.associateChildTab(document.documentId, childTab.metadata.id);
      // Map tab ID to unique versionId for future reference
      this.tabIdToVersionId.set(childTab.metadata.id, versionId);
      Logger.log(`[TabSync] Registered version ${childTab.metadata.diffType} for ${parentTab.metadata.label} (tabId: ${childTab.metadata.id}, versionId: ${versionId})`);
    }
  }

  /**
   * Limpia el mapeo de una child tab cuando se cierra
   */
  private cleanupTabVersionMapping(tabId: string): void {
    this.tabIdToVersionId.delete(tabId);
  }
  
  /**
   * Obtiene el versionId único asociado a una tab
   */
  getVersionIdForTab(tabId: string): string | undefined {
    return this.tabIdToVersionId.get(tabId);
  }

  /**
   * Limpia recursos y event listeners.
   * Delega el cleanup a los servicios especializados.
   */
  dispose(): void {
    Logger.log('[BaySync] Disposing BaySyncService');
    this.bayEventService.dispose();
    this.gitSyncService.dispose();
    this.documentManager.dispose();
    this.tabIdToVersionId.clear();
  }
}
