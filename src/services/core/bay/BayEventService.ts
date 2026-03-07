import * as vscode from 'vscode';
import { convertToBay, generateIdFromNativeTab } from '../helpers/tabConverter';
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
    private activeStateService: ActiveStateService,
    private syncPreviewOwnership?: () => void
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
        // Sync active state first
        const { hasChanges } = this.activeStateService.syncActiveState();
        
        // Then sync preview ownership
        if (this.syncPreviewOwnership) {
          this.syncPreviewOwnership();
        }
        
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

      // Si es una variant, asegurar que el parent existe PRIMERO
      if (st.metadata.parentId) {
        const parent = await this.bayHeadService.ensureParentExists(st, bay);
        
        if (!parent) {
          Logger.warn(`[BayEvent] Failed to ensure parent exists for variant: ${st.metadata.label}`);
          // No añadir la variant si no pudimos garantizar el parent
          continue;
        }
        
        Logger.log(`[BayEvent] Parent confirmed for variant: ${st.metadata.label} → ${parent.metadata.label}`);
      }

      // Añadir la bay/variant al estado
      this.stateService.addBay(st);

      // Si es variant, registrar en hierarchy ahora que SABEMOS que el parent existe
      if (st.metadata.parentId) {
        this.hierarchyService.registerChild(st.metadata.id, st.metadata.parentId);
        Logger.log(`[BayEvent] Variant registered in hierarchy: ${st.metadata.label}`);
      }

      hasChanges = true;
    }

    for (const bay of event.closed) {
      const id = generateIdFromNativeTab(bay);
      if (!id) { continue; }

      // Verificar si es un cierre intencional (ya procesado).
      // NO llamar clearIntentionalClose aquí: el mismo parent puede recibir
      // múltiples eventos de cierre si varios variants cierran a la vez.
      // El timeout de 2000ms en handleCloseVariant limpia los marcadores.
      if (this.stateService.isIntentionalClose(id)) {
        Logger.log(`[BayEvent] Ignoring intentional close (already processed): ${id}`);
        continue;
      }

      const existingBay = this.stateService.getBayById(id);
      if (existingBay) {
        Logger.log(`[BayEvent] Processing external close: ${existingBay.metadata.label} (ID: ${id}, parentId: ${existingBay.metadata.parentId || 'none'}, hasChildren: ${existingBay.state.hasChildren})`);
        this.stateService.removeBay(id);
        hasChanges = true;
      }
    }

    for (const bay of event.changed) {
      const id = generateIdFromNativeTab(bay);
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
      // First sync active state from native tabs
      const { hasChanges: activeChanges } = this.activeStateService.syncActiveState();
      
      // Then sync preview ownership (this can override isActive for preview owners)
      if (this.syncPreviewOwnership) {
        this.syncPreviewOwnership();
      }
      
      if (activeChanges || hasChanges) {
        this.stateService.notifyChange();
      }
    }
  }

  /**
   * Maneja cambios en grupos de editores.
   */
  private handleGroupChanges(): void {
    // Sync active state first
    const { hasChanges } = this.activeStateService.syncActiveState();
    
    // Then sync preview ownership (overrides active for preview owners)
    if (this.syncPreviewOwnership) {
      this.syncPreviewOwnership();
    }
    
    if (hasChanges) {
      this.stateService.notifyChange();
    }
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
