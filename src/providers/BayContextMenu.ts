import * as vscode from 'vscode';
import { Bay } from '../models/Bay';
import { BayStateService } from '../services/core/BayStateService';
import { CopilotService } from '../services/integration/CopilotService';

/**
 * Maneja el menú contextual de las pestañas.
 * Separado del provider para mantener responsabilidades claras.
 */
export class BayContextMenu {
  constructor(
    private readonly stateService: BayStateService,
    private readonly copilotService: CopilotService
  ) {}

  async show(bay: Bay): Promise<void> {
    const hasUri = !!bay.metadata.uri;
    const hasMultipleGroups = this.stateService.getGroups().length > 1;
    const items: vscode.QuickPickItem[] = [
      { label: '$(close)  Close' },
      { label: '$(close-all)  Close Others' },
      { label: '$(close-all)  Close to the Right' },
      { label: '', kind: vscode.QuickPickItemKind.Separator },
      { label: bay.state.isPinned ? '$(pin)  Unpin' : '$(pinned)  Pin' },
    ];

    if (hasMultipleGroups) {
      items.push(
        { label: '', kind: vscode.QuickPickItemKind.Separator },
        { label: '$(close-all)  Close Group' },
      );
    }

    if (hasUri) {
      items.push(
        { label: '', kind: vscode.QuickPickItemKind.Separator },
        { label: '$(files)  Reveal in Explorer View' },
        { label: '$(folder-opened)  Reveal in File Explorer' },
        { label: '$(history)  Open Timeline' },
        { label: '', kind: vscode.QuickPickItemKind.Separator },
        { label: '$(clippy)  Copy Relative Path' },
        { label: '$(copy)  Copy Path' },
        { label: '$(copy)  Copy File Contents' },
        { label: '$(files)  Duplicate File' },
        { label: '', kind: vscode.QuickPickItemKind.Separator },
        { label: '$(diff)  Compare with Active Editor' },
        { label: '$(git-compare)  Open Changes' },
        { label: '$(split-horizontal)  Split Right' },
        { label: '$(multiple-windows)  Move to New Window' },
      );
    }

    if (hasUri && this.copilotService.isAvailable()) {
      items.push(
        { label: '', kind: vscode.QuickPickItemKind.Separator },
        { label: '$(attach)  Add to Copilot Chat' },
      );
    }

    const pick = await vscode.window.showQuickPick(items, { placeHolder: bay.metadata.label });
    if (!pick) { return; }

    await this.executeAction(pick.label, bay);
  }

  private async executeAction(label: string, bay: Bay): Promise<void> {
    if      (label.includes('Close Others'))              { await bay.closeOthers(); }
    else if (label.includes('Close to the Right'))        { await bay.closeToRight(); }
    else if (label.includes('Close Group'))               { await bay.closeGroup(); }
    else if (label.includes('Close'))                     { await bay.close(); }
    else if (label.includes('Unpin'))                     { await bay.unpin();  this.stateService.reorderOnUnpin(bay.metadata.id); }
    else if (label.includes('Pin'))                       { await bay.pin();    this.stateService.reorderOnPin(bay.metadata.id); }
    else if (label.includes('Reveal in Explorer View'))   { await bay.revealInExplorerView(); }
    else if (label.includes('Reveal in File Explorer'))   { await bay.revealInFileExplorer(); }
    else if (label.includes('Open Timeline'))             { await bay.openTimeline(); }
    else if (label.includes('Copy Relative Path'))        { await bay.copyRelativePath(); }
    else if (label.includes('Copy Path'))                 { await bay.copyPath(); }
    else if (label.includes('Copy File Contents'))        { await bay.copyFileContents(); }
    else if (label.includes('Duplicate File'))            { await bay.duplicateFile(); }
    else if (label.includes('Compare'))                   { await bay.compareWithActive(); }
    else if (label.includes('Open Changes'))              { await bay.openChanges(); }
    else if (label.includes('Split Right'))               { await bay.splitRight(); }
    else if (label.includes('Move to New Window'))        { await bay.moveToNewWindow(); }
    else if (label.includes('Add to Copilot Chat'))       { await this.copilotService.addFileToChat(bay.metadata.uri); }
  }
}
