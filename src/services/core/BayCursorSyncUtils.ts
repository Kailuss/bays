import type { Bay } from '../../models/Bay';
import { updateEditorCursor } from './BayEditorUtils';
import { Logger } from '../../platform/logger';
import * as vscode from 'vscode';

/**
 * Synchronizes cursor position (line and column) between a parent bay and all its children.
 * If syncCursorPosition config is enabled, updates all related editors.
 *
 * @param bays lo ÚNICO que esto necesita del estado: resolver una bay por su id.
 *   Se declara estructuralmente en vez de recibir el `BayStateService` entero
 *   porque importarlo cerraría un ciclo (aquel módulo importa éste), y porque un
 *   `any` no es la respuesta a un ciclo: deja pasar cualquier cosa.
 * @param bayId Bay ID that changed cursor position
 * @param line Cursor line (1-based)
 * @param column Cursor column (1-based)
 * @param fetchVariants Function to fetch child bays
 */
type BayLookup = { getBayById(id: string): Bay | undefined };

export async function syncCursorPosition(
  bays: BayLookup,
  bayId: string,
  line: number,
  column: number,
  fetchVariants: (parentBayId: string) => Bay[]
): Promise<void> {
  const config = vscode.workspace.getConfiguration('bays');
  if (!config.get('syncCursorPosition', false)) {
    return; // Feature disabled
  }

  const bay = bays.getBayById(bayId);
  if (!bay) {
    return;
  }

  // Update position in current bay
  bay.state.cursorLine = line;
  bay.state.cursorColumn = column;

  // Determine bay family (parent + children or just children if is parent)
  const family: Bay[] = [];
  let parentBay: Bay | undefined;

  if (bay.metadata.sourceBayId) {
    // Is a child, find parent and siblings
    parentBay = bays.getBayById(bay.metadata.sourceBayId);
    if (parentBay) {
      family.push(parentBay);
      family.push(...fetchVariants(bay.metadata.sourceBayId));
    }
  } else {
    // Is a parent, find its children
    family.push(...fetchVariants(bay.metadata.id));
  }

  // Update position in all family members
  for (const familyBay of family) {
    if (familyBay.metadata.id === bayId) {
      continue; // Skip self
    }

    // Update state
    familyBay.state.cursorLine = line;
    familyBay.state.cursorColumn = column;

    // If bay has URI, try updating editor if open
    if (familyBay.metadata.uri) {
      await updateEditorCursor(familyBay.metadata.uri, line, column);
    }
  }

  Logger.log(`[BayHierarchy] Synced cursor position: line ${line}, col ${column} (${family.length} bays affected)`);
}
