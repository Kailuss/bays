import * as vscode from 'vscode';

export const STYLE_CONSTANTS = {
  // Bay dimensions
  BAY_HEIGHT              : 40,
  BAY_ICON_SIZE           : 16,
  BAY_PADDING_LEFT        : 8,
  BAY_PADDING_RIGHT       : 4,
  // Internal spacing
  ICON_TEXT_GAP           : 8,
  STATE_ICON_SIZE         : 14,
  HOVER_ICON_SIZE         : 16,
  // Description (path)
  DESCRIPTION_FONT_SIZE   : 11,
  DESCRIPTION_LINE_HEIGHT : 14,
  DESCRIPTION_OPACITY     : 0.7,
  // Hover
  HOVER_ICON_SPACING      : 4,
  // Borders
  BAY_TOP_BORDER_WIDTH    : 1,
  BAY_BOTTOM_BORDER_WIDTH : 1,
  // Dirty indicator
  DIRTY_INDICATOR_SIZE    : 8,
  // VS Code codicons (for reference)
  CODICONS                : {
    pin    : 'pin',
    pinned : 'pinned',
    close  : 'close',
    add    : 'add',
    window : 'window',
  },

  // VS Code color variables (for reference)
  COLORS: {
    foreground                      : 'foreground',
    descriptionForeground           : 'descriptionForeground',
    listActiveSelectionBackground   : 'list.activeSelectionBackground',
    listHoverBackground             : 'list.hoverBackground',
    listInactiveSelectionBackground : 'list.inactiveSelectionBackground',
    modified                        : 'gitDecoration.modifiedResourceForeground',
    untracked                       : 'gitDecoration.untrackedResourceForeground',
    ignored                         : 'gitDecoration.ignoredResourceForeground',
    iconForeground                  : 'icon.foreground',
    editorWarningForeground         : 'editorWarning.foreground',
    buttonHoverBackground           : 'button.hoverBackground',
    bayBorder                       : 'bay.border',
    editorGroupHeaderBaysBorder     : 'editorGroupHeader.baysBorder',
    panelBorder                     : 'panel.border',
  },
} as const;

/** Configuration shape for bays settings */
export type BaysConfiguration = {
  showFilePath       : boolean;
  compactMode        : boolean;
  iconSize           : number;
  enableHoverActions : boolean;
  showStateIcons     : boolean;
  enableDragDrop     : boolean;
};

/**
 * Lee la configuración `bays` del workspace y devuelve valores con los
 * valores por defecto ya aplicados.
 */
export function getConfiguration(): BaysConfiguration {
  const config = vscode.workspace.getConfiguration('bays');

  return {
    showFilePath       : config.get('showFilePath'      ,true)                         ,
    compactMode        : config.get('compactMode'       ,false)                        ,
    iconSize           : config.get('iconSize'          ,STYLE_CONSTANTS.BAY_ICON_SIZE),
    enableHoverActions : config.get('enableHoverActions',true)                         ,
    showStateIcons     : config.get('showStateIcons'    ,true)                         ,
    enableDragDrop     : config.get('enableDragDrop'    ,true)                         ,
  };
}
