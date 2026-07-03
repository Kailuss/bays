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

/** What syncPreviewOwnership() changed. It only ever adjusts the highlight (isActive). */
export type PreviewSyncResult = {
  activeChanged: boolean;  // a bay's isActive flipped → a partial highlight update is enough
};

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
      this.stateService.updateBayStateWithAnimation(bay);
    }
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
  syncPreviewOwnership(): PreviewSyncResult {
    // Find the active markdown-preview tab, if any.
    // NOTE: TabInputWebview.viewType arrives PREFIXED by VS Code (e.g.
    // "mainThreadWebview-markdown.preview"), so we must match by inclusion,
    // not strict equality — equality never matches and the sync silently no-ops.
    let activePreviewTab: vscode.Tab | null = null;
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (
          tab.input instanceof vscode.TabInputWebview &&
          tab.input.viewType.includes('markdown.preview') &&
          tab.isActive
        ) {
          activePreviewTab = tab;
          break;
        }
      }
      if (activePreviewTab) { break; }
    }

    // No active preview → normal active-state sync governs the highlight; nothing to do.
    if (!activePreviewTab) { return { activeChanged: false }; }

    const ownerBay = this.findPreviewSourceBay(activePreviewTab);
    if (!ownerBay) {
      // Diagnostic: a preview is showing but we couldn't match its source bay.
      Logger.warn(`[BaySync] Active preview but no source bay matched. label="${activePreviewTab.label}", column=${activePreviewTab.group.viewColumn}, mdBays=[${this.stateService.getAllBays().filter(b => b.metadata.fileExtension.match(/\.mdx?|\.markdown/)).map(b => `${b.metadata.fileName}@${b.state.viewColumn}`).join(', ')}]`);
      return { activeChanged: false };
    }

    // The preview webview is the active tab in its group, so the source's text
    // tab is not active there. Force the OWNER (source bay) to be the sole active
    // bay in its group so its sidebar row stays highlighted while the preview shows.
    // This does NOT touch viewMode/preferPreview, so it can't fight the toggle.
    let activeChanged = false;
    for (const bay of this.stateService.getAllBays()) {
      if (bay.state.viewColumn !== ownerBay.state.viewColumn) { continue; }
      const shouldBeActive = bay === ownerBay;
      if (bay.state.isActive !== shouldBeActive) {
        bay.state.isActive = shouldBeActive;
        activeChanged = true;
      }
    }

    Logger.log(`[BaySync] Preview active → source stays active: ${ownerBay.metadata.label} (activeChanged=${activeChanged})`);
    return { activeChanged };
  }

  /**
   * Encuentra la bay source (archivo Markdown) cuyo preview renderizado
   * corresponde a la pestaña de preview activa. Se empareja por nombre de
   * archivo (extraído del label "Preview x.md") y, preferentemente, viewColumn.
   *
   * Garantiza que la bay del fuente siga siendo la activa aunque se muestre el
   * preview: si el preview está en el mismo grupo que su fuente lo empareja por
   * columna; si se abrió "al lado" (otra columna) cae a un match por nombre
   * siempre que sea inequívoco (una sola bay Markdown con ese nombre).
   */
  private findPreviewSourceBay(previewTab: vscode.Tab): Bay | undefined {
    // The preview tab label is "<prefix> <filename>", where <prefix> is LOCALISED
    // ("Preview README.md" in English, "Vista previa README.md" in Spanish, ...).
    // So we must NOT key off the "Preview" prefix — instead match the source bay
    // whose file name is the label's suffix (with a space boundary so "a.md" does
    // not match "xa.md"). This is locale-independent.
    const label = previewTab.label;
    const viewColumn = previewTab.group.viewColumn;

    const isMarkdownSource = (bay: Bay): boolean => {
      const fileName = bay.metadata.fileName;
      if (!fileName || bay.metadata.bayType !== 'file') { return false; }
      if (!bay.metadata.fileExtension.match(/\.mdx?|\.markdown/)) { return false; }
      return label === fileName || label.endsWith(' ' + fileName);
    };

    const bays = this.stateService.getAllBays();

    // Prefer the source bay in the same editor group as the preview.
    const sameColumn = bays.find(bay => isMarkdownSource(bay) && bay.state.viewColumn === viewColumn);
    if (sameColumn) { return sameColumn; }

    // Preview opened to the side (different column): fall back to a name match,
    // but only when it is unambiguous (exactly one such Markdown bay).
    const candidates = bays.filter(isMarkdownSource);
    return candidates.length === 1 ? candidates[0] : undefined;
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
