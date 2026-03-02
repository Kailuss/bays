import * as vscode from 'vscode';
import { SideTab } from '../../models/Bay';

/**
 * Options accepted by the `workbench.action.chat.open` command.
 * Subset of the internal IChatViewOpenOptions interface.
 */
interface ChatOpenOptions {
  /** Prompt text to pre-fill in the chat input. */
  query?: string;
  /** If true, the query is placed in the input but not sent automatically. */
  isPartialQuery?: boolean;
  /** File URIs (or URI + range) to attach as context. */
  attachFiles?: (vscode.Uri | { uri: vscode.Uri; range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number } })[];
  /** Chat mode: 'agent', 'ask', or 'edit'. */
  mode?: string;
}

/**
 * Integración opcional con GitHub Copilot Chat.
 * Explicación práctica: permite añadir archivos al contexto de chat desde la UI.
 */
export class CopilotService {
  private copilotExtension?: vscode.Extension<unknown>;

  constructor() {
    this.copilotExtension = vscode.extensions.getExtension('github.copilot-chat');
  }

  /** Indica si la extensión GitHub Copilot Chat está disponible. */
  isAvailable(): boolean {
    return this.copilotExtension !== undefined;
  }

  /**
   * Añade un archivo al contexto de Copilot Chat.
   * Si la integración directa no está disponible usa el portapapeles como alternativa.
   * @param tab - The tab to add (updates integration state)
   */
  async addFileToChat(tab: SideTab): Promise<boolean>;
  /**
   * Añade un archivo al contexto de Copilot Chat (legacy signature).
   * @param uri - The URI to add (no state update)
   */
  async addFileToChat(uri: vscode.Uri | undefined): Promise<boolean>;
  async addFileToChat(tabOrUri: SideTab | vscode.Uri | undefined): Promise<boolean> {
    // Handle both signatures
    let uri: vscode.Uri | undefined;
    let tab: SideTab | undefined;
    
    if (tabOrUri instanceof SideTab) {
      tab = tabOrUri;
      uri = tab.metadata.uri;
    } else {
      uri = tabOrUri;
    }

    if (!uri) {
      return false;
    }
    if (!this.isAvailable()) {
      return false;
    }

    try {
      await vscode.commands.executeCommand('workbench.action.chat.open', {
        query: '',
        isPartialQuery: true,
        attachFiles: [uri],
      } satisfies ChatOpenOptions);
      
      // Update integration state if tab was provided
      if (tab) {
        tab.addToCopilotContext();
      }
      
      return true;
    } catch (error) {
      vscode.window.showWarningMessage(
        `Failed to attach file to Copilot Chat: ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  }

  /**
   * Añade varios archivos al contexto de Copilot Chat en una sola acción.
   * All files are attached simultaneously to a single chat session.
   * Updates integration state for all tabs.
   */
  async addFilesToChat(tabs: SideTab[], query?: string): Promise<boolean>;
  /**
   * Legacy signature: adds URIs without state update.
   */
  async addFilesToChat(uris: vscode.Uri[], query?: string): Promise<boolean>;
  async addFilesToChat(tabsOrUris: SideTab[] | vscode.Uri[], query?: string): Promise<boolean> {
    if (tabsOrUris.length === 0) {
      return false;
    }
    if (!this.isAvailable()) {
      return false;
    }

    // Determine if we have tabs or URIs
    const areTabs = tabsOrUris.length > 0 && tabsOrUris[0] instanceof SideTab;
    const tabs = areTabs ? (tabsOrUris as SideTab[]) : undefined;
    const uris = areTabs 
      ? (tabsOrUris as SideTab[]).map(t => t.metadata.uri).filter((u): u is vscode.Uri => !!u)
      : (tabsOrUris as vscode.Uri[]);

    try {
      await vscode.commands.executeCommand('workbench.action.chat.open', {
        query: query ?? '',
        isPartialQuery: !query,
        attachFiles: uris,
      } satisfies ChatOpenOptions);
      
      // Update integration state for all tabs
      if (tabs) {
        for (const tab of tabs) {
          if (tab.metadata.uri) {
            tab.addToCopilotContext();
          }
        }
      }
      
      return true;
    } catch (error) {
      vscode.window.showWarningMessage(
        `Failed to attach files to Copilot Chat: ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  }

  /** Muestra un QuickPick para seleccionar varios archivos y añadirlos al chat. */
  async addMultipleFiles(tabs: SideTab[]): Promise<void> {
    const fileTabs = tabs.filter(t => t.metadata.uri);
    if (fileTabs.length === 0) {
      vscode.window.showInformationMessage('No file tabs to add');
      return;
    }
    const selected = await vscode.window.showQuickPick(
      fileTabs.map(tab => ({
        label: tab.metadata.label,
        description: tab.metadata.detailLabel,
        detail: tab.metadata.tooltipText,
        tab,
      })),
      {
        canPickMany: true,
        placeHolder: 'Select files to add to Copilot Chat context',
      }
    );

    if (!selected || selected.length === 0) {
      return;
    }

    // Pass tabs directly to preserve state tracking
    const selectedTabs = selected.map(item => item.tab);

    const success = await this.addFilesToChat(selectedTabs);

    if (success) {
      vscode.window.showInformationMessage(
        `Added ${selectedTabs.length} file(s) to Copilot Chat context`
      );
    }
  }
}
