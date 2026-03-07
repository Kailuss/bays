import * as vscode from 'vscode';
import { BayStateService } from './BayStateService';
import { GitSyncService } from '../integration/GitSyncService';
import { BayHierarchyService } from './BayHierarchyService';
import { DocumentManager } from './DocumentManager';
import { BayEventService } from './bay/BayEventService';
import { BayHeadService } from './bay/BayHeadService';
import { ActiveStateService } from './bay/ActiveStateService';
import { Bay } from '../../models/Bay';
import { createTabGroup } from '../../models/BayGroup';
import { convertToBay, getDiagnosticSeverity } from './helpers/tabConverter';
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
 * NOTA: Las tabs de Markdown Preview se filtran directamente en convertToBay()
 * y se manejan como estado toggle (viewMode) en la bay del archivo fuente.
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
  // Esto permite rastrear qué version del documento corresponde a cada child bay
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
      this.activeStateService,
      () => this.syncPreviewOwnership() // Pass callback to sync preview
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

    const allBays: Bay[] = [];
    const variants: Array<{ bay: Bay; nativeTab: vscode.Tab }> = [];
    
    // First pass: collect all tabs, separating parents from children
    for (const group of vscode.window.tabGroups.all) {
      group.tabs.forEach((tab, idx) => {
        const st = convertToBay(tab, this.gitSyncService, idx);
        if (st) {
          if (st.metadata.sourceBayId) {
            // This is a variant bay (diff) - defer it
            variants.push({ bay: st, nativeTab: tab });
          } else {
            // This is a parent bay or standalone bay - add it immediately
            allBays.push(st);
          }
        }
      });
    }
    
    // Second pass: process child tabs after parents are loaded
    // Process sequentially to ensure parents are opened before children are added
    for (const { bay, nativeTab } of variants) {
      // Ensure parent exists (delegate to BayHeadService)
      const parent = await this.bayHeadService.ensureParentExistsForSync(bay, nativeTab, allBays);
      
      if (!parent) {
        Logger.warn(`[BaySync] Failed to ensure parent for variant, skipping: ${bay.metadata.label}`);
        continue;
      }
      
      Logger.log(`[BaySync] Parent confirmed for variant: ${bay.metadata.label} → ${parent.metadata.label}`);
      allBays.push(bay);
    }
    
    // Replace entire state with processed bays
    this.stateService.replaceBays(allBays);
    
    // Recalculate hierarchy after sync complete
    this.hierarchyService.recalculateAllCounts();
    
    // Sync preview ownership after all bays are loaded
    this.syncPreviewOwnership();
    
    Logger.log(`[BaySync] syncAll complete - ${allBays.length} tabs loaded`);
  }

  /**
   * Actualiza el estado activo de las tabs cuando cambia el editor activo.
   * Delega a ActiveStateService para la sincronización real.
   * 
   * También sincroniza la posición del cursor si la bay activa pertenece
   * a una familia parent-child.
   */
  private updateActiveTab(activeUri: vscode.Uri): void {
    // Delegate to syncActiveState which reads bay.isActive from the native API
    // This correctly handles the same file open in multiple groups
    const { hasChanges } = this.activeStateService.syncActiveState();
    if (hasChanges) {
      this.stateService.notifyChange();
    }

    // Sync cursor position when activating a bay from the parent-child family
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor && activeEditor.document.uri.toString() === activeUri.toString()) {
      const bay = this.stateService.findBayByUri(activeUri);
      if (bay && (bay.metadata.sourceBayId || bay.state.hasVariant)) {
        // This bay is part of a parent-child family, sync cursor position
        const selection = activeEditor.selection;
        const line = selection.active.line + 1;
        const column = selection.active.character + 1;
        this.hierarchyService.syncCursorPosition(bay.metadata.id, line, column);
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

    const bay = this.stateService.findBayByUri(uri);
    if (!bay) { return; }

    this.hierarchyService.syncCursorPosition(bay.metadata.id, line, column);
  }

  /**
   * Actualiza los diagnósticos y git status de una pestaña específica cuando cambian.
   */
  private updateTabDiagnostics(uri: vscode.Uri): void {
    const bay = this.stateService.findBayByUri(uri);
    if (!bay) { return; }

    const newDiagnosticSeverity = getDiagnosticSeverity(uri);
    const newGitStatus = this.gitSyncService.getGitStatus(uri);

    if (bay.state.diagnosticSeverity !== newDiagnosticSeverity || 
        bay.state.gitStatus !== newGitStatus) {
      Logger.log(`[BaySync] Updating diagnostics/git for: ${bay.metadata.label}`);
      bay.state.diagnosticSeverity = newDiagnosticSeverity;
      bay.state.gitStatus = newGitStatus;
      this.stateService.updateBayStateWithAnimation;
    }
  }

  /**
   * Asegura que existe un DocumentModel para una bay.
   * Si no existe, lo crea y lo asocia con la bay.
   * 
   * @param bay Bay para la cual asegurar que existe un documento
   */
  private ensureDocumentExists(bay: Bay): void {
    if (!bay.metadata.uri) {
      return;
    }

    // Check if document already exists
    const existing = this.documentManager.getDocumentByUri(bay.metadata.uri);
    if (existing) {
      // Associate parent bay if not already associated
      if (!existing.parentBayId) {
        this.documentManager.associateParentBay(existing.documentId, bay.metadata.id);
      }
      return;
    }

    // Create new document
    const document = this.documentManager.createDocument({
      baseUri: bay.metadata.uri,
      languageId: bay.metadata.languageId || 'plaintext',
      fileName: bay.metadata.fileName || 'untitled',
      fileExtension: bay.metadata.fileExtension,
      parentBayId: bay.metadata.id,
      fileSize: bay.metadata.fileSize,
      isReadOnly: bay.metadata.isReadOnly,
      isBinary: bay.metadata.isBinary,
    });

    Logger.log(`[TabSync] Created document for bay: ${bay.metadata.label} (docId: ${document.documentId})`);
  }

  /**
   * Registra una versión (diff) de un documento en el DocumentManager.
   * 
   * @param variant Variant que representa la versión
   * @param parentBay Parent bay del documento base
   */
  private registerTabVersion(variant: Bay, parentBay: Bay): void {
    if (!parentBay.metadata.uri || !variant.metadata.diffType) {
      return;
    }

    // Get or create the document
    const document = this.documentManager.getOrCreateDocument(
      parentBay.metadata.uri,
      parentBay.metadata.languageId || 'plaintext',
      parentBay.metadata.fileName || 'untitled',
      parentBay.metadata.fileExtension
    );

    // Associate parent if not already
    if (!document.parentBayId) {
      this.documentManager.associateParentBay(document.documentId, parentBay.metadata.id);
    }

    // Register the version
    const versionId = this.documentManager.registerVersion(document.documentId, {
      diffType: variant.metadata.diffType,
      originalUri: variant.metadata.originalUri,
      modifiedUri: variant.metadata.uri,
      label: variant.metadata.label,
      description: variant.metadata.detailLabel,
      stats: variant.state.diffStats,
      relatedBayId: variant.metadata.id,
    });

    if (versionId) {
      // Associate child bay with document
      this.documentManager.associateVariant(document.documentId, variant.metadata.id);
      // Map bay ID to unique versionId for future reference
      this.tabIdToVersionId.set(variant.metadata.id, versionId);
      Logger.log(`[TabSync] Registered version ${variant.metadata.diffType} for ${parentBay.metadata.label} (bayId: ${variant.metadata.id}, versionId: ${versionId})`);
    }
  }

  /**
   * Limpia el mapeo de una child bay cuando se cierra
   */
  private cleanupBayVersionMapping(bayId: string): void {
    this.tabIdToVersionId.delete(bayId);
  }
  
  /**
   * Obtiene el versionId único asociado a una bay
   */
  getVersionIdForBay(bayId: string): string | undefined {
    return this.tabIdToVersionId.get(bayId);
  }

  /**
   * Sincroniza el estado de preview ownership.
   * 
   * Busca tabs de Markdown Preview activas y actualiza el viewMode de sus bays source:
   * - Si hay un preview activo → bay source: viewMode = 'preview', se marca como activa
   * - Si el preview cambió de bay → bay anterior: viewMode = 'source'
   * - Las tabs de preview nunca se renderizan como bay (filtradas en convertToBay)
   * 
   * Comportamiento de isActive:
   * - Cuando se abre preview: source bay mantiene isActive = true
   * - Cuando cambia a otra bay o preview desaparece: source bay solo será activa si su tab nativa lo es
   * 
   * Invariant: Solo 1 Bay puede tener viewMode: 'preview' globalmente.
   */
  syncPreviewOwnership(): void {
    // Find all markdown preview tabs in VS Code
    const allGroups = vscode.window.tabGroups.all;
    let activePreviewTab: vscode.Tab | null = null;
    
    for (const group of allGroups) {
      for (const tab of group.tabs) {
        if (tab.input instanceof vscode.TabInputWebview) {
          const viewType = tab.input.viewType;
          if (viewType === 'markdown.preview' && tab.isActive) {
            activePreviewTab = tab;
            break;
          }
        }
      }
      if (activePreviewTab) {
        break;
      }
    }

    // Reset all bays that were in preview mode
    for (const bay of this.stateService.getAllBays()) {
      if (bay.state.viewMode === 'preview') {
        bay.state.viewMode = 'source';
        // Bay is no longer the preview owner, deactivate it
        // unless its actual source tab is active
        const nativeTab = this.findNativeTab(bay);
        if (nativeTab) {
          bay.state.isActive = nativeTab.isActive;
        } else {
          bay.state.isActive = false;
        }
      }
    }

    // If there's an active preview, find its source bay and mark it
    if (activePreviewTab) {
      // Extract filename from preview label: "Preview filename.md" → "filename.md"
      const previewLabel = activePreviewTab.label;
      const filenameMatch = previewLabel.match(/^Preview\s+(.+)$/);
      
      if (filenameMatch) {
        const filename = filenameMatch[1];
        
        // Find bay with matching filename in the same group
        const previewGroup = activePreviewTab.group;
        const sourceBay = this.stateService.getAllBays().find(bay => 
          bay.metadata.fileName === filename && 
          bay.metadata.bayType === 'file' &&
          bay.metadata.fileExtension.match(/\.mdx?|\.markdown/) &&
          bay.state.viewColumn === previewGroup.viewColumn
        );
        
        if (sourceBay) {
          sourceBay.state.viewMode = 'preview';
          // Source bay is the preview owner, mark it as active
          // This keeps it visually active in the sidebar even though preview tab is displayed
          sourceBay.state.isActive = true;
          Logger.log(`[BaySync] Preview active for: ${sourceBay.metadata.label}`);
        }
      }
    }
  }

  /**
   * Encuentra la tab nativa de VS Code correspondiente a una bay.
   * Usado internamente para verificar el estado real de la tab.
   */
  private findNativeTab(bay: Bay): vscode.Tab | null {
    for (const group of vscode.window.tabGroups.all) {
      if (group.viewColumn !== bay.state.viewColumn) {
        continue;
      }
      
      for (const tab of group.tabs) {
        const input = tab.input;
        
        // Match by URI for file tabs
        if (bay.metadata.uri && input) {
          if (input instanceof vscode.TabInputText && input.uri.toString() === bay.metadata.uri.toString()) {
            return tab;
          }
          if (input instanceof vscode.TabInputTextDiff && input.modified.toString() === bay.metadata.uri.toString()) {
            return tab;
          }
          if (input instanceof vscode.TabInputCustom && input.uri.toString() === bay.metadata.uri.toString()) {
            return tab;
          }
          if (input instanceof vscode.TabInputNotebook && input.uri.toString() === bay.metadata.uri.toString()) {
            return tab;
          }
        }
        // Match by label for webview tabs
        else if (!bay.metadata.uri && tab.label === bay.metadata.label) {
          return tab;
        }
      }
    }
    return null;
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
