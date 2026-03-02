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
 * Registra y procesa eventos de VS Code (tabs, editores, diagnósticos).
 * Delega a servicios especializados según el tipo de evento.
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
   * Registra todos los event listeners necesarios.
   */
  activate(): void {
    Logger.log('[BayEvent] Activating event listeners');

    this.disposables.push(
      vscode.window.tabGroups.onDidChangeTabs(async (event) => {
        await this.handleTabChanges(event);
      })
    );

    this.disposables.push(
      vscode.window.tabGroups.onDidChangeTabGroups(() => {
        this.handleGroupChanges();
      })
    );

    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => {
        const { hasChanges } = this.activeStateService.syncActiveState();
        if (hasChanges) {
          this.stateService.notifyChange();
        }
      })
    );

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
   * Maneja cambios en bays (opened/closed/changed).
   * Asegura que los variants tengan parents y actualiza el estado.
   */
  private async handleTabChanges(event: vscode.TabChangeEvent): Promise<void> {
    let hasChanges = false;

    for (const bay of event.opened) {
      const st = convertToBay(bay, this.gitSyncService);
      if (!st) { continue; }

      if (st.metadata.parentId) {
        await this.bayHeadService.ensureParentExists(st, bay);
      }

      this.stateService.addBay(st);

      if (st.metadata.parentId) {
        this.hierarchyService.registerChild(st.metadata.id, st.metadata.parentId);
      }

      hasChanges = true;
    }

    for (const bay of event.closed) {
      const id = this.generateIdFromTab(bay);
      if (!id) { continue; }

      const existingBay = this.stateService.getBayById(id);
      if (existingBay) {
        this.stateService.removeBay(id);
        hasChanges = true;
      }
    }

    for (const bay of event.changed) {
      const id = this.generateIdFromTab(bay);
      if (!id) { continue; }

      const existingBay = this.stateService.getBayById(id);
      if (existingBay) {
        let bayChanged = false;
        
        if (existingBay.state.isPreview !== bay.isPreview) {
          existingBay.state.isPreview = bay.isPreview;
          bayChanged = true;
        }
        
        if (existingBay.state.isPinned !== bay.isPinned) {
          existingBay.state.isPinned = bay.isPinned;
          bayChanged = true;
        }
        
        if (existingBay.state.isDirty !== bay.isDirty) {
          existingBay.state.isDirty = bay.isDirty;
          bayChanged = true;
        }

        if (bayChanged) {
          hasChanges = true;
        }
      }
    }

    if (hasChanges) {
      const { hasChanges: activeChanges } = this.activeStateService.syncActiveState();
      if (activeChanges || hasChanges) {
        this.stateService.notifyChange();
      }
    }
  }

  /**
   * Maneja cambios en grupos de editores.
   */
  private handleGroupChanges(): void {
    const { hasChanges } = this.activeStateService.syncActiveState();
    if (hasChanges) {
      this.stateService.notifyChange();
    }
  }

  /**
   * Genera un ID desde un native tab sin crear un Bay completo.
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
