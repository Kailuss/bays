import * as vscode from 'vscode';
import { Bay } from '../../../models/Bay';
import { BayStateService } from '../BayStateService';
import { BayHierarchyService } from '../BayHierarchyService';
import { GitSyncService } from '../../integration/GitSyncService';
import { convertToBay } from '../helpers/tabConverter';
import { Logger } from '../../../utils/logger';

/**
 * BayHeadService - Gestión de Parent Placeholders y Apertura Automática
 * 
 * Responsabilidades:
 * - Asegurar que los parent tabs existan antes de añadir variants
 * - Crear parent placeholders temporales si el parent no está abierto
 * - Abrir automáticamente parent tabs cuando sea necesario
 * - Reemplazar placeholders con parents reales cuando aparecen
 * 
 * Casos de uso:
 * 1. Variant aparece antes que su parent → crear placeholder con isLoading: true
 * 2. Parent no existe en VS Code → intentar abrir automáticamente
 * 3. Parent existe en grupo pero no en estado → convertir y añadir
 * 4. Sync completo → buscar parents en array temporal antes de estado
 */
export class BayHeadService {
  constructor(
    private stateService: BayStateService,
    private hierarchyService: BayHierarchyService,
    private gitSyncService: GitSyncService
  ) {}

  /**
   * Asegura que el parent bay de un variant exista en el estado.
   * Si el archivo base no está abierto como bay, lo abre automáticamente
   * y lo añade al estado, luego asocia el variant.
   * 
   * Contexto: handleTabChanges (evento opened)
   */
  async ensureParentExists(childTab: Bay, nativeChildTab: vscode.Tab): Promise<void> {
    const parentId = childTab.metadata.parentId;
    if (!parentId) { return; }

    // Check if parent already exists
    if (this.stateService.getBayById(parentId)) {
      return; // Parent exists, all good
    }

    // Parent doesn't exist - we need to find or create it
    // For diff tabs, the parent is the file bay with the same URI in the same group
    const group = nativeChildTab.group;
    const childUri = childTab.metadata.uri;
    if (!childUri) { return; }

    // Search for a file bay with matching URI in the same group
    let parentNativeTab: vscode.Tab | undefined;
    for (const bay of group.tabs) {
      if (bay.input instanceof vscode.TabInputText) {
        if (bay.input.uri.toString() === childUri.toString()) {
          parentNativeTab = bay;
          break;
        }
      }
    }

    // If found in the group, convert and add it
    if (parentNativeTab) {
      const parentBay = convertToBay(parentNativeTab, this.gitSyncService);
      if (parentBay) {
        Logger.log(`[BayHead] Creating parent bay for variant: ${childTab.metadata.label} → ${parentBay.metadata.label}`);
        this.stateService.addBay(parentBay);
        // Inherit state from parent
        this.hierarchyService.inheritState(childTab, parentBay);
      }
    } else {
      // Parent bay doesn't exist in VS Code - open it automatically
      Logger.log(`[BayHead] Parent bay not found, opening automatically: ${childUri.fsPath}`);
      
      try {
        // Open the file in the same group as the child bay
        const doc = await vscode.workspace.openTextDocument(childUri);
        await vscode.window.showTextDocument(doc, {
          viewColumn: group.viewColumn,
          preview: false, // Open as non-preview to ensure it stays open
          preserveFocus: true, // Don't steal focus from current bay
        });
        
        // After opening, search for the newly created bay and add it to state
        // The onDidChangeTabs event will eventually catch it, but we can add it immediately
        for (const bay of group.tabs) {
          if (bay.input instanceof vscode.TabInputText) {
            if (bay.input.uri.toString() === childUri.toString()) {
              const parentBay = convertToBay(bay, this.gitSyncService);
              if (parentBay) {
                Logger.log(`[BayHead] Successfully opened and added parent bay: ${parentBay.metadata.label}`);
                this.stateService.addBay(parentBay);
                this.hierarchyService.inheritState(childTab, parentBay);
              }
              break;
            }
          }
        }
      } catch (error) {
        // If we can't open the parent (e.g., file doesn't exist anymore),
        // the child will be rendered as orphan
        Logger.log(`[BayHead] Failed to open parent bay: ${error}`);
      }
    }
  }

  /**
   * Versión de ensureParentExists para el contexto de syncAll.
   * Busca el parent en el array temporal antes de que se agregue al estado.
   * Si no existe, lo abre automáticamente.
   * 
   * Contexto: syncAll (sincronización completa inicial)
   */
  async ensureParentExistsForSync(
    variant: Bay, 
    variantVSTab: vscode.Tab, 
    allBays: Bay[]
    
  ): Promise<void> {
    const parentId = variant.metadata.parentId;
    if (!parentId) { return; }

    // Check if parent already exists in the array
    const existingParent = allBays.find(t => t.metadata.id === parentId);
    if (existingParent) {
      this.hierarchyService.inheritState(variant, existingParent); // Inherit state from parent
      return;
    }

    // Parent doesn't exist - we need to find or create it
    const group = variantVSTab.group;
    const variantMetadataUri = variant.metadata.uri;
    if (!variantMetadataUri) { return; }

    // Search for a file vsTab with matching URI in the same group
    let parentVSTab: vscode.Tab | undefined;
    for (const VSTab of group.tabs) {
      if (VSTab.input instanceof vscode.TabInputText) {
        if (VSTab.input.uri.toString() === variantMetadataUri.toString()) {
          parentVSTab = VSTab;
          break;
        }
      }
    }

    // If found, convert and add it to the array
    if (parentVSTab) {
      const parentBay = convertToBay(parentVSTab, this.gitSyncService);
      if (parentBay) {
        Logger.log(`[BayHead] Creating parent bay for variant during syncAll: ${variant.metadata.label} → ${parentBay.metadata.label}`);
        allBays.push(parentBay);
        this.hierarchyService.inheritState(variant, parentBay);
      }
    } else {
      // Parent bay doesn't exist in VS Code - open it automatically
      Logger.log(`[BayHead] Parent bay not found during sync, opening automatically: ${variantMetadataUri.fsPath}`);
      
      try {
        // Open the file in the same group as the child bay
        const doc = await vscode.workspace.openTextDocument(variantMetadataUri);
        await vscode.window.showTextDocument(doc, {
          viewColumn: group.viewColumn,
          preview: false, // Open as non-preview to ensure it stays open
          preserveFocus: true, // Don't steal focus from current bay
        });
        
        // After opening, search for the newly created bay and add it to array
        for (const bay of group.tabs) {
          if (bay.input instanceof vscode.TabInputText) {
            if (bay.input.uri.toString() === variantMetadataUri.toString()) {
              const parentBay = convertToBay(bay, this.gitSyncService);
              if (parentBay) {
                Logger.log(`[BayHead] Successfully opened and added parent bay during sync: ${parentBay.metadata.label}`);
                allBays.push(parentBay);
                this.hierarchyService.inheritState(variant, parentBay);
              }
              break;
            }
          }
        }
      } catch (error) {
        // If we can't open the parent (e.g., file doesn't exist anymore),
        // the child will be rendered as orphan
        Logger.log(`[BayHead] Failed to open parent bay during sync: ${error}`);
      }
    }
  }
}
