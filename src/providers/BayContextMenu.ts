import * as vscode from 'vscode';
import { SideTab } from '../models/SideTab';
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

  async show(tab: SideTab): Promise<void> {
    const hasUri = !!tab.metadata.uri;
    const hasMultipleGroups = this.stateService.getGroups().length > 1;
    const items: vscode.QuickPickItem[] = [
      { label: '$(close)  Close' },
      { label: '$(close-all)  Close Others' },
      { label: '$(close-all)  Close to the Right' },
      { label: '', kind: vscode.QuickPickItemKind.Separator },
      { label: tab.state.isPinned ? '$(pin)  Unpin' : '$(pinned)  Pin' },
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

    const pick = await vscode.window.showQuickPick(items, { placeHolder: tab.metadata.label });
    if (!pick) { return; }

    await this.executeAction(pick.label, tab);
  }

  private async executeAction(label: string, tab: SideTab): Promise<void> {
    if      (label.includes('Close Others'))              { await tab.closeOthers(); }
    else if (label.includes('Close to the Right'))        { await tab.closeToRight(); }
    else if (label.includes('Close Group'))               { await tab.closeGroup(); }
    else if (label.includes('Close'))                     { await tab.close(); }
    else if (label.includes('Unpin'))                     { await tab.unpin();  this.stateService.reorderOnUnpin(tab.metadata.id); }
    else if (label.includes('Pin'))                       { await tab.pin();    this.stateService.reorderOnPin(tab.metadata.id); }
    else if (label.includes('Reveal in Explorer View'))   { await tab.revealInExplorerView(); }
    else if (label.includes('Reveal in File Explorer'))   { await tab.revealInFileExplorer(); }
    else if (label.includes('Open Timeline'))             { await tab.openTimeline(); }
    else if (label.includes('Copy Relative Path'))        { await tab.copyRelativePath(); }
    else if (label.includes('Copy Path'))                 { await tab.copyPath(); }
    else if (label.includes('Copy File Contents'))        { await tab.copyFileContents(); }
    else if (label.includes('Duplicate File'))            { await tab.duplicateFile(); }
    else if (label.includes('Compare'))                   { await tab.compareWithActive(); }
    else if (label.includes('Open Changes'))              { await tab.openChanges(); }
    else if (label.includes('Split Right'))               { await tab.splitRight(); }
    else if (label.includes('Move to New Window'))        { await tab.moveToNewWindow(); }
    else if (label.includes('Add to Copilot Chat'))       { await this.copilotService.addFileToChat(tab.metadata.uri); }
  }
}
