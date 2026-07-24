import * as vscode from 'vscode';
import { VSCODE_COMMANDS } from '../../commands';
import type { DynamicFileQuickAction } from '../types';
import { byExtension } from '../matchers';

/**
 * Markdown: abre el preview renderizado.
 *
 * El preview es una VARIANTE real de la bay (fila hija con su propia pestaña),
 * así que aquí no hay toggle: este botón solo CREA el preview, y el builder lo
 * oculta cuando la bay ya tiene una variante de preview. El foco lo toma la
 * propia pestaña del preview (setFocus: false — no reactivar el fuente).
 */
export const MARKDOWN_TOGGLE_ACTION: DynamicFileQuickAction = {
  id: 'toggleMarkdownPreview',
  setFocus: false,
  match: byExtension('.md', '.mdx', '.markdown'),
  resolve: () => ({
    icon: 'preview',
    tooltip: 'Open Preview',
    actionId: 'openMarkdownPreview',
  }),
  execute: async (uri) => {
    await vscode.commands.executeCommand(VSCODE_COMMANDS.MARKDOWN_SHOW_PREVIEW, uri);
  },
};
