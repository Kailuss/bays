import * as vscode from 'vscode';
import { BayStateService } from './BayStateService';
import { GitSyncService } from '../integration/GitSyncService';
import { BayHierarchyService } from './BayHierarchyService';
import { BayEventService } from './bay/BayEventService';
import { BayHeadService } from './bay/BayHeadService';
import { ActiveStateService } from './bay/ActiveStateService';
import { Bay } from '../../models/Bay';
import { createTabGroup } from '../../models/BayGroup';
import { convertToBay, demoteOrphanVariant, getDiagnosticSeverity } from './helpers/tabConverter';
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

  // Specialized services (post-refactoring)
  private bayEventService: BayEventService;
  private bayHeadService: BayHeadService;
  private activeStateService: ActiveStateService;

  // Coalescing de onDidChangeDiagnostics (evento de alta frecuencia)
  private static readonly DIAGNOSTICS_DEBOUNCE_MS = 100;
  private pendingDiagnosticUris = new Map<string, vscode.Uri>();
  private diagnosticsFlushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private stateService: BayStateService) {
    this.gitSyncService = new GitSyncService(this.stateService);
    this.hierarchyService = new BayHierarchyService(this.stateService);

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
      () => this.resyncAll(),           // Full resync on structural group changes
      (task) => this.enqueue(task)      // Shared serialization queue for all sync work
    );
    
    // Inject services into state service to avoid circular dependencies
    this.stateService.setHierarchyService(this.hierarchyService);
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

    // Initial full sync, THROUGH the queue: the listeners registered right after
    // also enqueue their work, so nothing mutates state while syncAll's awaits
    // are in flight (before, an early tab/group event could interleave with the
    // initial sync and be clobbered by its trailing replaceBays).
    void this.enqueue(() => this.syncAll());

    // Delegate event listener registration to BayEventService
    this.bayEventService.activate();

    // Register diagnostic listener (handled directly by BaySyncService).
    // onDidChangeDiagnostics es de alta frecuencia (dispara por cada pasada de
    // cada linter); se coalescen las URIs en una ventana corta y se procesa el
    // lote una sola vez, en vez de git+severity+postMessage por evento.
    context.subscriptions.push(
      vscode.languages.onDidChangeDiagnostics((event) => {
        for (const uri of event.uris) {
          this.pendingDiagnosticUris.set(uri.toString(), uri);
        }
        if (this.diagnosticsFlushTimer) { return; }
        this.diagnosticsFlushTimer = setTimeout(() => {
          this.diagnosticsFlushTimer = null;
          const uris = [...this.pendingDiagnosticUris.values()];
          this.pendingDiagnosticUris.clear();
          for (const uri of uris) {
            this.updateTabDiagnostics(uri);
          }
        }, BaySyncService.DIAGNOSTICS_DEBOUNCE_MS);
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
    
    // First pass: collect all tabs, separating parents from children.
    // Una preview huérfana (sin sourceBayId porque su .md no está abierto)
    // sigue siendo una variante — se difiere también para que la segunda
    // pasada pueda abrir su source (regla: una variante nunca vive sin parent).
    for (const group of vscode.window.tabGroups.all) {
      group.tabs.forEach((tab, idx) => {
        const st = convertToBay(tab, this.gitSyncService, idx);
        if (st) {
          if (st.metadata.sourceBayId || st.metadata.diffType === 'preview') {
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
    for (const { bay: converted, nativeTab } of variants) {
      let bay = converted;
      if (bay.metadata.diffType === 'preview') {
        // Parent ya convertido en la primera pasada → solo heredar y enlazar.
        const parent = allBays.find(t => t.metadata.id === bay.metadata.sourceBayId);
        if (parent) {
          this.hierarchyService.inheritState(bay, parent);
          allBays.push(bay);
          continue;
        }

        // Huérfana: abrir el source y reconvertir la variante ya enlazada.
        // Si no se puede resolver, se degrada a bay raíz (nunca se descarta ni
        // se deja como variante suelta). Con el relink hecho, cae al
        // ensureParentExistsForSync de abajo, que encuentra la tab del source
        // recién abierta y crea su bay.
        const relinked = await this.bayHeadService.adoptPreviewOrphan(bay, nativeTab);
        if (!relinked) {
          Logger.warn(`[BaySync] Preview source unresolved: ${bay.metadata.label} — demoted to root bay`);
          allBays.push(demoteOrphanVariant(bay));
          continue;
        }
        bay = relinked;
      }

      // Ensure parent exists (delegate to BayHeadService)
      const parent = await this.bayHeadService.ensureParentExistsForSync(bay, nativeTab, allBays);

      if (parent) {
        Logger.log(`[BaySync] Parent confirmed for variant: ${bay.metadata.label} → ${parent.metadata.label}`);
      } else {
        // Igual que en BayEventService: el parent no se pudo resolver ni crear
        // (archivo movido/renombrado) → REGLA: nunca una variante suelta, se
        // degrada a bay raíz. Descartarla la borraba del panel por completo.
        bay = demoteOrphanVariant(bay);
        Logger.warn(`[BaySync] Parent unresolvable for variant: ${bay.metadata.label} — demoted to root bay`);
      }

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
   * Serializado con la cola compartida: dos eventos de grupo rápidos no solapan
   * resyncs (el segundo espera al primero), y tampoco se solapan con
   * handleTabChanges ni con el syncAll inicial.
   */
  private syncQueue: Promise<void> = Promise.resolve();

  /**
   * Serializa TODO el trabajo de sincronización (syncAll inicial, resyncs
   * estructurales y los handlers de eventos de tabs) en una única cola de
   * promesas: dos tareas nunca mutan el estado a la vez. Un fallo se loggea
   * y no rompe la cadena.
   */
  enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.syncQueue.then(task);
    this.syncQueue = run.catch(err => {
      Logger.error('[BaySync] Queued sync task failed', err);
    });
    return run;
  }

  resyncAll(): Promise<void> {
    return this.enqueue(() => this.doResync());
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
   * Actualiza los diagnósticos y git status de una pestaña específica cuando cambian.
   */
  private updateTabDiagnostics(uri: vscode.Uri): void {
    // The same file can be open in several groups (distinct bays). Diagnostics
    // are per-URI, so every matching bay must be refreshed, not just the first.
    const bays = this.stateService.findBaysByUri(uri);
    if (bays.length === 0) { return; }

    const newDiagnosticSeverity = getDiagnosticSeverity(uri);
    const newGitStatus = this.gitSyncService.getGitStatus(uri);

    for (const bay of bays) {
      if (bay.state.diagnosticSeverity !== newDiagnosticSeverity ||
          bay.state.gitStatus !== newGitStatus) {
        Logger.log(`[BaySync] Updating diagnostics/git for: ${bay.metadata.label}`);
        bay.state.diagnosticSeverity = newDiagnosticSeverity;
        bay.state.gitStatus = newGitStatus;
        this.stateService.updateBayStateWithAnimation(bay);
      }
    }
  }

  /**
   * Limpia recursos y event listeners.
   * Delega el cleanup a los servicios especializados.
   */
  dispose(): void {
    Logger.log('[BaySync] Disposing BaySyncService');
    if (this.diagnosticsFlushTimer) {
      clearTimeout(this.diagnosticsFlushTimer);
      this.diagnosticsFlushTimer = null;
    }
    this.bayEventService.dispose();
    this.gitSyncService.dispose();
  }
}
