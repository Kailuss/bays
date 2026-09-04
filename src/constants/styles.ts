import * as vscode from 'vscode';
import type { ViewPrefs } from '../services/ui/ViewPrefs';
import { parseHoverDelay, parseMotion } from '../utils/settingsRules';

/** Configuration shape for bays settings */
export type BaysConfiguration = {
  showFilePath       : boolean;
  compactMode        : boolean;
  enableHoverActions : boolean;
  enableDragDrop     : boolean;
  /** `workbench.hover.delay`, leído y no duplicado. */
  hoverDelay         : number;
  /** `bays.animations` fundido con `workbench.reduceMotion`. */
  motion             : boolean;
};

/**
 * Lo que gobierna la vista ahora mismo.
 *
 * Las dos claves que un control de la vista CONMUTA se leen de la capa por
 * proyecto (`ViewPrefs`), que cae al ajuste mientras no haya nada guardado; las
 * otras dos solo se tocan en la UI de settings, así que se leen de ahí. El
 * criterio es el CONTROL: lo que la vista conmuta desde un botón propio se
 * guarda por proyecto, y lo que solo se escribe a mano no.
 */
export function getConfiguration(prefs: ViewPrefs): BaysConfiguration {
  const config = vscode.workspace.getConfiguration('bays');

  return {
    showFilePath       : prefs.get('showFilePath'),
    compactMode        : prefs.get('compactMode'),
    enableHoverActions : config.get('enableHoverActions', true),
    enableDragDrop     : config.get('enableDragDrop'    , true),
    hoverDelay         : parseHoverDelay(vscode.workspace.getConfiguration('workbench.hover').get('delay')),
    motion             : parseMotion(
      config.get('animations'),
      vscode.workspace.getConfiguration('workbench').get('reduceMotion'),
    ),
  };
}
