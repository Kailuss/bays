// Singleton del API del webview de VS Code.
// acquireVsCodeApi() solo puede llamarse UNA vez por carga del documento;
// todos los módulos importan `vscode` desde aquí.

/** Estado persistido entre rebuilds del webview via getState()/setState(). */
export type WebviewState = {
  scrollY?: number;
  collapsedGroups?: string[];
};

export type VsCodeWebviewApi = {
  postMessage(message: unknown): void;
  getState(): WebviewState | undefined;
  setState(state: WebviewState): void;
};

declare function acquireVsCodeApi(): VsCodeWebviewApi;

export const vscode = acquireVsCodeApi();
