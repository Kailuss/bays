import * as vscode from 'vscode';

/** Configuration shape for bays settings */
export type BaysConfiguration = {
  showFilePath       : boolean;
  compactMode        : boolean;
  enableHoverActions : boolean;
  enableDragDrop     : boolean;
};

/**
 * Lee la configuración `bays` del workspace y devuelve valores con los
 * valores por defecto ya aplicados.
 */
export function getConfiguration(): BaysConfiguration {
  const config = vscode.workspace.getConfiguration('bays');

  return {
    showFilePath       : config.get('showFilePath'      ,true) ,
    compactMode        : config.get('compactMode'       ,false),
    enableHoverActions : config.get('enableHoverActions',true) ,
    enableDragDrop     : config.get('enableDragDrop'    ,true) ,
  };
}
