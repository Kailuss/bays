import { Bay } from '../models/Bay';
import { BayStateService } from '../services/core/BayStateService';
import { CopilotService } from '../services/integration/CopilotService';
import type { MenuItem } from '../shared/protocol';
import { ICONS } from '../shared/icons';

// El modelo del menú vive en el protocolo compartido (cruza postMessage y el
// cliente lo consume con los MISMOS tipos). Re-exportado por conveniencia.
export type { MenuItem } from '../shared/protocol';

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
      { id: 'close',        label: 'Close',              icon: ICONS.menu.close     },
      { id: 'closeOthers',  label: 'Close Others',       icon: ICONS.menu.closeMany },
      { id: 'closeToRight', label: 'Close to the Right', icon: ICONS.menu.closeMany },
      { type: 'separator' },
    ];

    items.push(
      bay.state.isPinned
        ? { id: 'unpin', label: 'Unpin', icon: ICONS.menu.unpin }
        : { id: 'pin',   label: 'Pin',   icon: ICONS.menu.pin   }
    );

    if (hasMultipleGroups && !locked) {
      items.push(
        { type: 'separator' },
        { id: 'closeGroup', label: 'Close Group', icon: ICONS.menu.closeMany },
      );
    }

    if (hasUri) {
      items.push(
        { type: 'separator' },
        { id: 'revealInExplorer',     label: 'Reveal in Explorer View',  icon: ICONS.menu.revealInView },
        { id: 'revealInFileExplorer', label: 'Reveal in File Explorer',  icon: ICONS.menu.revealInOs   },
        { id: 'openTimeline',         label: 'Open Timeline',            icon: ICONS.menu.timeline     },
        { type: 'separator' },
        { id: 'copyRelativePath',     label: 'Copy Relative Path',       icon: ICONS.menu.copyRelative },
        { id: 'copyPath',             label: 'Copy Path',                icon: ICONS.menu.copyPath     },
        { id: 'copyFileContents',     label: 'Copy File Contents',       icon: ICONS.menu.copyPath     },
        { id: 'duplicateFile',        label: 'Duplicate File',           icon: ICONS.menu.duplicate    },
        { type: 'separator' },
        { id: 'compareWithActive',    label: 'Compare with Active Editor', icon: ICONS.menu.compare      },
        { id: 'openChanges',          label: 'Open Changes',             icon: ICONS.menu.changes      },
        { id: 'splitRight',           label: 'Split Right',              icon: ICONS.menu.split        },
        { id: 'moveToNewWindow',      label: 'Move to New Window',       icon: ICONS.menu.newWindow    },
      );
    }

    if (hasUri && this.copilotService.isAvailable()) {
      items.push(
        { type: 'separator' },
        { id: 'addToChat', label: 'Add to Copilot Chat', icon: ICONS.menu.chat },
      );
    }

    return items;
  }

  /** Ejecuta el item elegido en el webview. Ignora los ids desconocidos. */
  async execute(actionId: string, bay: Bay): Promise<void> {
    switch (actionId) {
      case 'close'                : await bay.close();                 break;
      case 'closeOthers'          : await bay.closeOthers();           break;
      case 'closeToRight'         : await bay.closeToRight();          break;
      case 'closeGroup'           : await bay.closeGroup();            break;
      case 'pin'                  : await bay.pin();   this.stateService.reorderOnPin(bay.metadata.id);   break;
      case 'unpin'                : await bay.unpin(); this.stateService.reorderOnUnpin(bay.metadata.id); break;
      case 'revealInExplorer'     : await bay.revealInExplorer();      break;
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
      case 'addToChat'            : await this.copilotService.addFileToChat(bay); break;
    }
  }
}
