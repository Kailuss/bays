import * as vscode from 'vscode';
import { Bay } from '../../models/Bay';

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
  /**
   * Indica si la extensión GitHub Copilot Chat está disponible.
   * Se consulta en vivo (no se cachea en el constructor) para que instalar o
   * deshabilitar Copilot Chat a mitad de sesión se refleje sin recargar la
   * ventana. `getExtension` es una búsqueda barata en un mapa.
   */
  isAvailable(): boolean {
    return vscode.extensions.getExtension('github.copilot-chat') !== undefined;
  }

  /**
   * Añade un archivo al contexto de Copilot Chat.
   * Si la integración directa no está disponible usa el portapapeles como alternativa.
   * @param bay - The bay to add (updates integration state)
   */
  async addFileToChat(bay: Bay): Promise<boolean>;
  /**
   * Añade un archivo al contexto de Copilot Chat (legacy signature).
   * @param uri - The URI to add (no state update)
   */
  async addFileToChat(uri: vscode.Uri | undefined): Promise<boolean>;
  async addFileToChat(tabOrUri: Bay | vscode.Uri | undefined): Promise<boolean> {
    // Handle both signatures
    let uri: vscode.Uri | undefined;
    let bay: Bay | undefined;
    
    if (tabOrUri instanceof Bay) {
      bay = tabOrUri;
      uri = bay.metadata.uri;
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
      
      // Update integration state if bay was provided
      if (bay) {
        bay.addToCopilotContext();
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
  async addFilesToChat(tabs: Bay[], query?: string): Promise<boolean>;
  /**
   * Legacy signature: adds URIs without state update.
   */
  async addFilesToChat(uris: vscode.Uri[], query?: string): Promise<boolean>;
  async addFilesToChat(tabsOrUris: Bay[] | vscode.Uri[], query?: string): Promise<boolean> {
    if (tabsOrUris.length === 0) {
      return false;
    }
    if (!this.isAvailable()) {
      return false;
    }

    // Determine if we have tabs or URIs
    const areTabs = tabsOrUris.length > 0 && tabsOrUris[0] instanceof Bay;
    const tabs = areTabs ? (tabsOrUris as Bay[]) : undefined;
    const uris = areTabs 
      ? (tabsOrUris as Bay[]).map(t => t.metadata.uri).filter((u): u is vscode.Uri => !!u)
      : (tabsOrUris as vscode.Uri[]);

    try {
      await vscode.commands.executeCommand('workbench.action.chat.open', {
        query: query ?? '',
        isPartialQuery: !query,
        attachFiles: uris,
      } satisfies ChatOpenOptions);
      
      // Update integration state for all tabs
      if (tabs) {
        for (const bay of tabs) {
          if (bay.metadata.uri) {
            bay.addToCopilotContext();
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
  async addMultipleFiles(tabs: Bay[]): Promise<void> {
    const fileTabs = tabs.filter(t => t.metadata.uri);
    if (fileTabs.length === 0) {
      vscode.window.showInformationMessage('No file tabs to add');
      return;
    }
    const selected = await vscode.window.showQuickPick(
      fileTabs.map(bay => ({
        label: bay.metadata.label,
        description: bay.metadata.detailLabel,
        detail: bay.metadata.tooltipText,
        bay,
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
    const selectedTabs = selected.map(item => item.bay);

    const success = await this.addFilesToChat(selectedTabs);

    if (success) {
      vscode.window.showInformationMessage(
        `Added ${selectedTabs.length} file(s) to Copilot Chat context`
      );
    }
  }
}
