import * as vscode from 'vscode';
import { Bay                 } from '../../../models/Bay';
import { BayStateService     } from '../BayStateService';
import { BayHierarchyService } from '../BayHierarchyService';
import { GitSyncService      } from '../../integration/GitSyncService';
import { convertToBay        } from '../helpers/tabConverter';
import { Logger              } from '../../../utils/logger';

/**
 * BayHeadService - Gestión de Parents para Variants
 *
 * Asegura que los parent bays existan antes de añadir variants.
 * Abre automáticamente parents faltantes y gestiona la herencia de estado.
 */
export class BayHeadService {
  constructor(
    private stateService     : BayStateService,
    private hierarchyService : BayHierarchyService,
    private gitSyncService   : GitSyncService
  ) {}

  /**
   * Asegura que el parent bay de un variant exista.
   * Si no está abierto, lo abre automáticamente y asocia el variant.
   */
  async ensureParentExists(variant: Bay, VSTab: vscode.Tab): Promise<void> {
    const variantParentId = variant.metadata.parentId;
    if (!variantParentId) { return; }

    if (this.stateService.getBayById(variantParentId)) {
      return;
    }

    const group = VSTab.group;
    const childUri = variant.metadata.uri;
    if (!childUri) { return; }

    let parentVSTab: vscode.Tab | undefined;
    for (const tab of group.tabs) {
      if (tab.input instanceof vscode.TabInputText) {
        if (tab.input.uri.toString() === childUri.toString()) {
          parentVSTab = tab;
          break;
        }
      }
    }

    if (parentVSTab) {
      const parentBay = convertToBay(parentVSTab, this.gitSyncService);
      if (parentBay) {
        Logger.log(`[BayHead] Creating parent bay for variant: ${variant.metadata.label} → ${parentBay.metadata.label}`);
        this.stateService.addBay(parentBay);
        this.hierarchyService.inheritState(variant, parentBay);
      }
    } else {
      Logger.log(`[BayHead] Parent bay not found, opening automatically: ${childUri.fsPath}`);

      try {
        const textDocument = await vscode.workspace.openTextDocument(childUri);
        await vscode.window.showTextDocument(textDocument, {
          viewColumn: group.viewColumn,
          preview: false,
          preserveFocus: true,
        });

        for (const tab of group.tabs) {
          if (tab.input instanceof vscode.TabInputText) {
            if (tab.input.uri.toString() === childUri.toString()) {
              const parentBay = convertToBay(tab, this.gitSyncService);
              if (parentBay) {
                Logger.log(`[BayHead] Successfully opened and added parent bay: ${parentBay.metadata.label}`);
                this.stateService.addBay(parentBay);
                this.hierarchyService.inheritState(variant, parentBay);
              }
              break;
            }
          }
        }
      } catch (error) {
        Logger.log(`[BayHead] Failed to open parent bay: ${error}`);
      }
    }
  }

  /**
   * Asegura que el parent exista durante syncAll.
   * Busca en el array temporal y abre automáticamente si es necesario.
   */
  async ensureParentExistsForSync(
    variant: Bay, 
    variantVSTab: vscode.Tab, 
    allBays: Bay[]
    
  ): Promise<void> {
    const parentId = variant.metadata.parentId;
    if (!parentId) { return; }

    const existingParent = allBays.find(t => t.metadata.id === parentId);
    if (existingParent) {
      this.hierarchyService.inheritState(variant, existingParent);
      return;
    }

    const group = variantVSTab.group;
    const variantMetadataUri = variant.metadata.uri;
    if (!variantMetadataUri) { return; }

    let parentVSTab: vscode.Tab | undefined;
    for (const tab of group.tabs) {
      if (tab.input instanceof vscode.TabInputText) {
        if (tab.input.uri.toString() === variantMetadataUri.toString()) {
          parentVSTab = tab;
          break;
        }
      }
    }

    if (parentVSTab) {
      const parentBay = convertToBay(parentVSTab, this.gitSyncService);
      if (parentBay) {
        Logger.log(`[BayHead] Creating parent bay for variant during syncAll: ${variant.metadata.label} → ${parentBay.metadata.label}`);
        allBays.push(parentBay);
        this.hierarchyService.inheritState(variant, parentBay);
      }
    } else {
      Logger.log(`[BayHead] Parent bay not found during sync, opening automatically: ${variantMetadataUri.fsPath}`);

      try {
        const textDocument = await vscode.workspace.openTextDocument(variantMetadataUri);
        await vscode.window.showTextDocument(textDocument, {
          viewColumn: group.viewColumn,
          preview: false,
          preserveFocus: true,
        });

        for (const tab of group.tabs) {
          if (tab.input instanceof vscode.TabInputText) {
            if (tab.input.uri.toString() === variantMetadataUri.toString()) {
              const parentBay = convertToBay(tab, this.gitSyncService);
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
        Logger.log(`[BayHead] Failed to open parent bay during sync: ${error}`);
      }
    }
  }
}
