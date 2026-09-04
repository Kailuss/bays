import * as vscode from 'vscode';
import { Bay                 } from '../../../models/Bay';
import { BayStateService     } from '../BayStateService';
import { BayHierarchyService } from '../BayHierarchyService';
import { GitSyncService      } from '../../integration/GitSyncService';
import { convertToBay        } from '../helpers/tabConverter';
import { Logger              } from '../../../platform/logger';
import { fileBayId           } from '../../../utils/idRules';

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
   *
   * @returns El parent bay si existe o fue creado exitosamente, undefined si falló
   */
  async ensureParentExists(variant: Bay, VSTab: vscode.Tab): Promise<Bay | undefined> {
    const variantParentId = variant.metadata.sourceBayId;
    if (!variantParentId) { return undefined; }

    // Verificar si el parent ya existe
    const existingParent = this.stateService.getBayById(variantParentId);
    if (existingParent) {
      Logger.log(`[BayHead] Parent already exists: ${existingParent.metadata.label}`);
      return existingParent;
    }

    const group = VSTab.group;

    // La URI del PARENT, no la de la variante: para diffs de git/timeline/snapshot
    // la URI de la variante lleva esquema propio y abrirla crearía una pestaña
    // fantasma con el contenido del índice en vez del archivo.
    const parentUri = variant.metadata.sourceUri;
    if (!parentUri) {
      Logger.warn(`[BayHead] Variant has parentId but no sourceUri: ${variant.metadata.label}`);
      return undefined;
    }

    const parentVSTab = findTabForBayId(group, variantParentId);

    if (parentVSTab) {
      const parentBay = this.adoptParentTab(parentVSTab, variant, variantParentId);
      if (parentBay) {
        Logger.log(`[BayHead] Creating parent bay for variant: ${variant.metadata.label} → ${parentBay.metadata.label}`);
        return parentBay;
      }
      return undefined;
    }

    Logger.log(`[BayHead] Parent bay not found, opening automatically: ${parentUri.fsPath}`);

    try {
      const textDocument = await vscode.workspace.openTextDocument(parentUri);
      await vscode.window.showTextDocument(textDocument, {
        viewColumn: group.viewColumn,
        preview: false,
        preserveFocus: true,
      });

      // After showTextDocument resolves, the onDidChangeTabs event has already
      // fired and handleTabChanges has added the parent bay to state.
      // Check state directly first — this is more reliable than scanning group.tabs.
      const parentInState = this.stateService.getBayById(variantParentId);
      if (parentInState) {
        Logger.log(`[BayHead] Parent found in state after open: ${parentInState.metadata.label}`);
        this.hierarchyService.inheritState(variant, parentInState);
        return parentInState;
      }

      // Fallback: scan group.tabs in case the event hasn't been processed yet
      const openedTab = findTabForBayId(group, variantParentId);
      if (openedTab) {
        const parentBay = this.adoptParentTab(openedTab, variant, variantParentId);
        if (parentBay) {
          Logger.log(`[BayHead] Parent created from tab scan after open: ${parentBay.metadata.label}`);
          return parentBay;
        }
      }

      Logger.warn(`[BayHead] Parent not found in state or tabs after open: ${parentUri.fsPath}`);
    } catch (error) {
      Logger.warn(`[BayHead] Failed to open parent bay: ${error}`);
    }

    return undefined;
  }

  /**
   * Asegura que el parent exista durante syncAll.
   * Busca en el array temporal y abre automáticamente si es necesario.
   *
   * @returns El parent bay si existe o fue creado exitosamente, undefined si falló
   */
  async ensureParentExistsForSync(
    variant: Bay,
    variantVSTab: vscode.Tab,
    allBays: Bay[]

  ): Promise<Bay | undefined> {
    const parentId = variant.metadata.sourceBayId;
    if (!parentId) { return undefined; }

    const existingParent = allBays.find(t => t.metadata.id === parentId);
    if (existingParent) {
      this.hierarchyService.inheritState(variant, existingParent);
      Logger.log(`[BayHead] Parent found in sync array: ${existingParent.metadata.label}`);
      return existingParent;
    }

    const group = variantVSTab.group;
    const parentUri = variant.metadata.sourceUri;
    if (!parentUri) {
      Logger.warn(`[BayHead] Variant has parentId but no sourceUri during sync: ${variant.metadata.label}`);
      return undefined;
    }

    const parentVSTab = findTabForBayId(group, parentId);

    if (parentVSTab) {
      const parentBay = this.buildParentBay(parentVSTab, variant, parentId);
      if (parentBay) {
        Logger.log(`[BayHead] Creating parent bay for variant during syncAll: ${variant.metadata.label} → ${parentBay.metadata.label}`);
        allBays.push(parentBay);
        return parentBay;
      }
      return undefined;
    }

    Logger.log(`[BayHead] Parent bay not found during sync, opening automatically: ${parentUri.fsPath}`);

    try {
      const textDocument = await vscode.workspace.openTextDocument(parentUri);
      await vscode.window.showTextDocument(textDocument, {
        viewColumn: group.viewColumn,
        preview: false,
        preserveFocus: true,
      });

      const openedTab = findTabForBayId(group, parentId);
      if (openedTab) {
        const parentBay = this.buildParentBay(openedTab, variant, parentId);
        if (parentBay) {
          Logger.log(`[BayHead] Successfully opened and added parent bay during sync: ${parentBay.metadata.label}`);
          allBays.push(parentBay);
          return parentBay;
        }
      }
    } catch (error) {
      Logger.log(`[BayHead] Failed to open parent bay during sync: ${error}`);
    }

    return undefined;
  }

  /** Convierte la tab del parent y la registra en el estado. */
  private adoptParentTab(parentVSTab: vscode.Tab, variant: Bay, expectedId: string): Bay | undefined {
    const parentBay = this.buildParentBay(parentVSTab, variant, expectedId);
    if (!parentBay) { return undefined; }
    this.stateService.addBay(parentBay);
    return parentBay;
  }

  /**
   * Convierte la tab del parent a Bay y hereda estado.
   * Rechaza el candidato si su id no es el que la variante declara como parent:
   * registrarlo dejaría a la variante huérfana (se dibujaría como fila raíz).
   */
  private buildParentBay(parentVSTab: vscode.Tab, variant: Bay, expectedId: string): Bay | undefined {
    const parentBay = convertToBay(parentVSTab, this.gitSyncService);
    if (!parentBay) { return undefined; }

    if (parentBay.metadata.id !== expectedId) {
      Logger.warn(`[BayHead] Parent id mismatch for ${variant.metadata.label}: expected ${expectedId}, got ${parentBay.metadata.id}`);
      return undefined;
    }

    this.hierarchyService.inheritState(variant, parentBay);
    return parentBay;
  }
}

/**
 * Localiza la tab nativa cuyo bay id coincide con `bayId`.
 *
 * Se compara por ID (no por URI suelta) porque el parentId de una variante puede
 * derivar de la URI original del diff, no de la suya propia; comparar URIs a ojo
 * es justo lo que dejaba variantes colgando de un parent inexistente.
 */
function findTabForBayId(group: vscode.TabGroup, bayId: string): vscode.Tab | undefined {
  for (const tab of group.tabs) {
    const uri = nativeTabUri(tab);
    if (uri && fileBayId(uri.toString(), group.viewColumn) === bayId) { return tab; }
  }
  return undefined;
}

/** URI del archivo que respalda una tab nativa (texto, custom editor o notebook). */
function nativeTabUri(tab: vscode.Tab): vscode.Uri | undefined {
  if (tab.input instanceof vscode.TabInputText)     { return tab.input.uri; }
  if (tab.input instanceof vscode.TabInputCustom)   { return tab.input.uri; }
  if (tab.input instanceof vscode.TabInputNotebook) { return tab.input.uri; }
  return undefined;
}
