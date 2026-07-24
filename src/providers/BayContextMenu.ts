import { Bay } from '../models/Bay';
import { BayStateService } from '../services/core/BayStateService';
import { CopilotService } from '../services/integration/CopilotService';

/**
 * Un item del menú contextual, tal y como viaja al webview.
 *
 * Serializable a propósito: cruza `postMessage`, así que nada de funciones ni
 * de instancias. La acción va como `id` y vuelve por el mismo canal.
 */
export type MenuItem =
  | { type: 'separator' }
  | {
      type?: 'item';
      /** Identificador estable que devuelve el webview al elegir el item. */
      id: string;
      label: string;
      /** Nombre de codicon, sin el prefijo `codicon-`. */
      icon?: string;
      keybinding?: string;
      /** `false` lo dibuja atenuado y no seleccionable. */
      enabled?: boolean;
      /** Dibuja la marca de verificación en el hueco de la izquierda. */
      checked?: boolean;
      tooltip?: string;
      submenu?: MenuItem[];
    };

/**
 * Menú contextual de las bays.
 *
 * Sólo construye el modelo y ejecuta la acción elegida: el menú lo dibuja el
 * webview (`BaysContextMenu`, réplica del nativo) porque un QuickPick aparece
 * centrado arriba y no bajo el cursor, que es donde se espera un menú
 * contextual. El host sigue siendo la única fuente de verdad de qué items hay.
 */
export class BayContextMenu {
  constructor(
    private readonly stateService: BayStateService,
    private readonly copilotService: CopilotService
  ) {}

  /** Items para esta bay, en el orden en que se pintan. */
  build(bay: Bay): MenuItem[] {
    const hasUri = !!bay.metadata.uri;
    const hasMultipleGroups = this.stateService.getGroups().length > 1;

    // Un grupo bloqueado no ofrece cerrar por ninguna vía: si el menú siguiera
    // listando "Close", el candado sólo escondería el botón, no protegería nada.
    const locked = this.stateService.getGroup(bay.state.groupId)?.isLocked ?? false;

    const items: MenuItem[] = locked ? [] : [
      { id: 'close',        label: 'Close',             icon: 'close'     },
      { id: 'closeOthers',  label: 'Close Others',      icon: 'close-all' },
      { id: 'closeToRight', label: 'Close to the Right', icon: 'close-all' },
      { type: 'separator' },
    ];

    items.push(
      bay.state.isPinned
        ? { id: 'unpin', label: 'Unpin', icon: 'pin',    checked: true }
        : { id: 'pin',   label: 'Pin',   icon: 'pinned', checked: false }
    );

    if (hasMultipleGroups && !locked) {
      items.push(
        { type: 'separator' },
        { id: 'closeGroup', label: 'Close Group', icon: 'close-all' },
      );
    }

    if (hasUri) {
      items.push(
        { type: 'separator' },
        { id: 'revealInExplorerView', label: 'Reveal in Explorer View',  icon: 'files'          },
        { id: 'revealInFileExplorer', label: 'Reveal in File Explorer',  icon: 'folder-opened'  },
        { id: 'openTimeline',         label: 'Open Timeline',            icon: 'history'        },
        { type: 'separator' },
        { id: 'copyRelativePath',     label: 'Copy Relative Path',       icon: 'clippy'         },
        { id: 'copyPath',             label: 'Copy Path',                icon: 'copy'           },
        { id: 'copyFileContents',     label: 'Copy File Contents',       icon: 'copy'           },
        { id: 'duplicateFile',        label: 'Duplicate File',           icon: 'files'          },
        { type: 'separator' },
        { id: 'compareWithActive',    label: 'Compare with Active Editor', icon: 'diff'         },
        { id: 'openChanges',          label: 'Open Changes',             icon: 'git-compare'    },
        { id: 'splitRight',           label: 'Split Right',              icon: 'split-horizontal' },
        { id: 'moveToNewWindow',      label: 'Move to New Window',       icon: 'multiple-windows' },
      );
    }

    if (hasUri && this.copilotService.isAvailable()) {
      items.push(
        { type: 'separator' },
        { id: 'addToChat', label: 'Add to Copilot Chat', icon: 'attach' },
      );
    }

    return items;
  }

  /** Ejecuta el item elegido en el webview. Ignora los ids desconocidos. */
  async execute(actionId: string, bay: Bay): Promise<void> {
    switch (actionId) {
      case 'close'                : await bay.close();                 break;
      case 'closeOthers'          : await bay.closeOthers();           break;
      case 'closeToRight'         : await bay.closeToDown();           break;
      case 'closeGroup'           : await bay.closeGroup();            break;
      case 'pin'                  : await bay.pin();   this.stateService.reorderOnPin(bay.metadata.id);   break;
      case 'unpin'                : await bay.unpin(); this.stateService.reorderOnUnpin(bay.metadata.id); break;
      case 'revealInExplorerView' : await bay.revealInExplorerView();  break;
      case 'revealInFileExplorer' : await bay.revealInFileExplorer();  break;
      case 'openTimeline'         : await bay.openTimeline();          break;
      case 'copyRelativePath'     : await bay.copyRelativePath();      break;
      case 'copyPath'             : await bay.copyPath();              break;
      case 'copyFileContents'     : await bay.copyFileContents();      break;
      case 'duplicateFile'        : await bay.duplicateFile();         break;
      case 'compareWithActive'    : await bay.compareWithActive();     break;
      case 'openChanges'          : await bay.openChanges();           break;
      case 'splitRight'           : await bay.splitRight();            break;
      case 'moveToNewWindow'      : await bay.moveToNewWindow();       break;
      case 'addToChat'            : await this.copilotService.addFileToChat(bay.metadata.uri); break;
    }
  }
}
