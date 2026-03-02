import * as vscode from 'vscode';
import { convertToBay } from '../helpers/tabConverter';
import { BayStateService } from '../BayStateService';
import { GitSyncService } from '../../integration/GitSyncService';
import { BayHierarchyService } from '../BayHierarchyService';
import { BayHeadService } from './BayHeadService';
import { ActiveStateService } from './ActiveStateService';
import { Logger } from '../../../utils/logger';

/**
 * BayEventService - Gestión de Eventos de VS Code
 * 
 * Responsabilidades:
 * - Registrar event listeners de VS Code (tabGroups, activeTextEditor, diagnostics)
 * - Procesar eventos de apertura/cierre/cambio de tabs
 * - Invocar servicios especializados según el tipo de evento
 * 
 * Delegación:
 * - BayHeadService: Asegurar existencia de parents para variants
 * - ActiveStateService: Actualizar estado activo después de cambios
 * - BayStateService: Añadir/remover/actualizar tabs en el estado
 * - BayHierarchyService: Registrar relaciones parent-child
 * - DocumentManager: Crear y asociar DocumentModels con tabs
 */
export class BayEventService {
  private disposables: vscode.Disposable[] = [];

  constructor(
    private stateService: BayStateService,
    private gitSyncService: GitSyncService,
    private hierarchyService: BayHierarchyService,
    private bayHeadService: BayHeadService,
    private activeStateService: ActiveStateService
  ) {}

  /**
   * Registra todos los event listeners necesarios para mantener
   * el estado sincronizado con VS Code.
   */
  activate(): void {
    Logger.log('[BayEvent] Activating event listeners');

    // 1. Bay changes (opened/closed)
    this.disposables.push(
      vscode.window.tabGroups.onDidChangeTabs(async (event) => {
        await this.handleTabChanges(event);
      })
    );

    // 2. Bay group changes (created/closed)
    this.disposables.push(
      vscode.window.tabGroups.onDidChangeTabGroups(() => {
        this.handleGroupChanges();
      })
    );

    // 3. Active text editor changes
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => {
        const { hasChanges } = this.activeStateService.syncActiveState();
        if (hasChanges) {
          this.stateService.notifyChange();
        }
      })
    );

    // 4. Diagnostic changes (errors/warnings)
    // Note: Diagnostic handling is delegated to BaySyncService's updateTabDiagnostics()
    // which is triggered by VS Code's onDidChangeDiagnostics event

    // 5. Text editor selection changes (for cursor position sync)
    this.disposables.push(
      vscode.window.onDidChangeTextEditorSelection((event) => {
        const uri = event.textEditor.document.uri;
        const bay = this.stateService.findBayByUri(uri);
        if (!bay || !event.selections[0]) { return; }

        const selection = event.selections[0];
        const line = selection.active.line + 1;
        const column = selection.active.character + 1;

        this.hierarchyService.syncCursorPosition(bay.metadata.id, line, column);
      })
    );

    Logger.log('[BayEvent] Event listeners activated');
  }

  /**
   * Maneja cambios en bays (opened/closed).
   * 
   * Flujo:
   * 1. Opened bays: Convertir a Bay, asegurar parent si es variant, añadir al estado
   * 2. Closed bays: Remover del estado, notificar cambio
   * 3. Changed bays: Actualizar estado (preview, pinned, dirty)
   * 
   * Delegación:
   * - BayHeadService.ensureParentExists(): Si el bay es variant
   * - ActiveStateService.syncActiveState(): Después de añadir/remover
   * - BayHierarchyService.registerChild(): Si el bay tiene parentId
   */
  private async handleTabChanges(event: vscode.TabChangeEvent): Promise<void> {
    let hasChanges = false;

    // Handle opened tabs
    for (const bay of event.opened) {
      const st = convertToBay(bay, this.gitSyncService);
      if (!st) { continue; }

      // If it's a variant bay, ensure parent exists first
      if (st.metadata.parentId) {
        await this.bayHeadService.ensureParentExists(st, bay);
      }

      // Add bay to state
      this.stateService.addBay(st);

      // Register in hierarchy if it has a parent
      if (st.metadata.parentId) {
        this.hierarchyService.registerChild(st.metadata.id, st.metadata.parentId);
      }

      hasChanges = true;
    }

    // Handle closed tabs
    for (const bay of event.closed) {
      const id = this.generateIdFromTab(bay);
      if (!id) { continue; }

      const existingBay = this.stateService.getBayById(id);
      if (existingBay) {
        this.stateService.removeBay(id);
        hasChanges = true;
      }
    }

    // Handle changed bays (preview, pinned, dirty state changes)
    for (const bay of event.changed) {
      const id = this.generateIdFromTab(bay);
      if (!id) { continue; }

      const existingBay = this.stateService.getBayById(id);
      if (existingBay) {
        let bayChanged = false;
        
        // Update preview state
        if (existingBay.state.isPreview !== bay.isPreview) {
          existingBay.state.isPreview = bay.isPreview;
          bayChanged = true;
        }
        
        // Update pinned state
        if (existingBay.state.isPinned !== bay.isPinned) {
          existingBay.state.isPinned = bay.isPinned;
          bayChanged = true;
        }
        
        // Update dirty state
        if (existingBay.state.isDirty !== bay.isDirty) {
          existingBay.state.isDirty = bay.isDirty;
          bayChanged = true;
        }

        if (bayChanged) {
          hasChanges = true;
        }
      }
    }

    // Sync active state after processing all changes
    if (hasChanges) {
      const { hasChanges: activeChanges } = this.activeStateService.syncActiveState();
      if (activeChanges || hasChanges) {
        this.stateService.notifyChange();
      }
    }
  }

  /**
   * Maneja cambios en grupos de editores.
   * Simplemente dispara una sincronización completa del estado activo.
   */
  private handleGroupChanges(): void {
    const { hasChanges } = this.activeStateService.syncActiveState();
    if (hasChanges) {
      this.stateService.notifyChange();
    }
  }

  /**
   * Genera un ID desde un native bay sin crear un Bay completo.
   * Usado para identificar tabs en eventos de cierre/cambio.
   */
  private generateIdFromTab(bay: vscode.Tab): string | undefined {
    const input = bay.input;
    const viewColumn = bay.group.viewColumn;

    if (input instanceof vscode.TabInputText || input instanceof vscode.TabInputNotebook) {
      return `${input.uri.toString()}-${viewColumn}`;
    }
    
    if (input instanceof vscode.TabInputTextDiff) {
      return `${input.original.toString()}-${viewColumn}`;
    }
    
    if (input instanceof vscode.TabInputWebview) {
      // For webviews, use viewType if available, fallback to generic identifier
      const viewType = (input as any).viewType || 'webview';
      return `webview:${viewType}-${viewColumn}`;
    }
    
    if (input instanceof vscode.TabInputCustom) {
      return `${input.uri.toString()}-${viewColumn}`;
    }

    return undefined;
  }

  /**
   * Limpia todos los event listeners.
   */
  dispose(): void {
    Logger.log('[BayEvent] Disposing event listeners');
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
  }
}
