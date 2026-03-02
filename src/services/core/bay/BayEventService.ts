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

    // 1. Tab changes (opened/closed)
    this.disposables.push(
      vscode.window.tabGroups.onDidChangeTabs(async (event) => {
        await this.handleTabChanges(event);
      })
    );

    // 2. Tab group changes (created/closed)
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
        const tab = this.stateService.findTabByUri(uri);
        if (!tab || !event.selections[0]) { return; }

        const selection = event.selections[0];
        const line = selection.active.line + 1;
        const column = selection.active.character + 1;

        this.hierarchyService.syncCursorPosition(tab.metadata.id, line, column);
      })
    );

    Logger.log('[BayEvent] Event listeners activated');
  }

  /**
   * Maneja cambios en tabs (opened/closed).
   * 
   * Flujo:
   * 1. Opened tabs: Convertir a SideTab, asegurar parent si es variant, añadir al estado
   * 2. Closed tabs: Remover del estado, notificar cambio
   * 3. Changed tabs: Actualizar estado (preview, pinned, dirty)
   * 
   * Delegación:
   * - BayHeadService.ensureParentExists(): Si el tab es variant
   * - ActiveStateService.syncActiveState(): Después de añadir/remover
   * - BayHierarchyService.registerChild(): Si el tab tiene parentId
   */
  private async handleTabChanges(event: vscode.TabChangeEvent): Promise<void> {
    let hasChanges = false;

    // Handle opened tabs
    for (const tab of event.opened) {
      const st = convertToBay(tab, this.gitSyncService);
      if (!st) { continue; }

      // If it's a variant tab, ensure parent exists first
      if (st.metadata.parentId) {
        await this.bayHeadService.ensureParentExists(st, tab);
      }

      // Add tab to state
      this.stateService.addTab(st);

      // Register in hierarchy if it has a parent
      if (st.metadata.parentId) {
        this.hierarchyService.registerChild(st.metadata.id, st.metadata.parentId);
      }

      hasChanges = true;
    }

    // Handle closed tabs
    for (const tab of event.closed) {
      const id = this.generateIdFromTab(tab);
      if (!id) { continue; }

      const existingTab = this.stateService.getTab(id);
      if (existingTab) {
        this.stateService.removeTab(id);
        hasChanges = true;
      }
    }

    // Handle changed tabs (preview, pinned, dirty state changes)
    for (const tab of event.changed) {
      const id = this.generateIdFromTab(tab);
      if (!id) { continue; }

      const existingTab = this.stateService.getTab(id);
      if (existingTab) {
        let tabChanged = false;
        
        // Update preview state
        if (existingTab.state.isPreview !== tab.isPreview) {
          existingTab.state.isPreview = tab.isPreview;
          tabChanged = true;
        }
        
        // Update pinned state
        if (existingTab.state.isPinned !== tab.isPinned) {
          existingTab.state.isPinned = tab.isPinned;
          tabChanged = true;
        }
        
        // Update dirty state
        if (existingTab.state.isDirty !== tab.isDirty) {
          existingTab.state.isDirty = tab.isDirty;
          tabChanged = true;
        }

        if (tabChanged) {
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
   * Genera un ID desde un native tab sin crear un SideTab completo.
   * Usado para identificar tabs en eventos de cierre/cambio.
   */
  private generateIdFromTab(tab: vscode.Tab): string | undefined {
    const input = tab.input;
    const viewColumn = tab.group.viewColumn;

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
