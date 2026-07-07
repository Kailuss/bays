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
 * @see src/services/core/AGENT.md
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
      () => this.resyncAll() // Full resync on structural group changes
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

    // Rebuild the group set from the native API. setGroups replaces the whole
    // map, which also PRUNES stale groups (closed splits, renumbered columns) —
    // the old addGroup-only loop left ghost groups behind forever.
    this.stateService.setGroups(vscode.window.tabGroups.all.map(createTabGroup));

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
      // Preview variants don't go through BayHeadService (they have no uri and
      // would be dropped). If their parent is present, inherit; otherwise they
      // render as orphans — never skip them.
      if (bay.metadata.diffType === 'preview') {
        const parent = allBays.find(t => t.metadata.id === bay.metadata.sourceBayId);
        if (parent) { this.hierarchyService.inheritState(bay, parent); }
        allBays.push(bay);
        continue;
      }

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

    Logger.log(`[BaySync] syncAll complete - ${allBays.length} tabs loaded`);
  }

  /**
   * Re-sincronización completa tras un cambio ESTRUCTURAL de grupos (split
   * creado/cerrado → VS Code renumera viewColumns, invalidando los IDs de bay,
   * que incluyen la columna). En vez de renumerar IDs incrementalmente (frágil:
   * viven en el Map, los grupos, la jerarquía y el DOM), se reconstruye el
   * estado desde la API nativa preservando el estado local que un resync
   * destruiría: el orden manual (drag & drop) por grupo.
   *
   * Serializado con una promesa-cola: dos eventos de grupo rápidos no solapan
   * resyncs (el segundo espera al primero).
   */
  private resyncInFlight: Promise<void> = Promise.resolve();

  resyncAll(): Promise<void> {
    this.resyncInFlight = this.resyncInFlight.then(() => this.doResync());
    return this.resyncInFlight;
  }

  private async doResync(): Promise<void> {
    Logger.log('[BaySync] Structural group change → full resync');

    // Snapshot the manual (drag & drop) order. Keyed by URI (not bay id) because
    // the id embeds the viewColumn, which is exactly what just changed. A global
    // uri→index map suffices: sorting is stable, so same-file-in-two-groups
    // instances keep their native relative order between themselves.
    const orderByUri = new Map<string, number>();
    let orderIndex = 0;
    for (const group of this.stateService.getGroups()) {
      for (const bay of group.bays) {
        const uri = bay.metadata.uri?.toString();
        if (!uri) { continue; }
        orderByUri.set(uri, orderIndex++);
      }
    }

    await this.syncAll();

    // Re-apply the manual order within each new group.
    for (const group of this.stateService.getGroups()) {
      group.bays.sort((a, b) => {
        const ia = a.metadata.uri ? orderByUri.get(a.metadata.uri.toString()) : undefined;
        const ib = b.metadata.uri ? orderByUri.get(b.metadata.uri.toString()) : undefined;
        if (ia === undefined && ib === undefined) { return 0; }
        if (ia === undefined) { return 1; }   // new bays go after known ones
        if (ib === undefined) { return -1; }
        return ia - ib;
      });
      group.bays.forEach((bay, idx) => { bay.state.indexInGroup = idx; });
    }

    this.stateService.notifyChange();
    Logger.log('[BaySync] Resync complete');
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
      this.stateService.updateBayStateWithAnimation(bay);
    }
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
  }
}
