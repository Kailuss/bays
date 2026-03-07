import * as vscode from 'vscode';
import type { BayMetadata, BayState } from '../Bay';
import { BayHelpers } from '../BayHelpers';
import { Logger } from '../../utils/logger';
import { VSCODE_COMMANDS } from '../../constants/commands';
import { TIMINGS } from '../../constants/timings';

/**
 * Activation actions - Activar y hacer focus en tabs
 */

const MARKDOWN_EXTENSIONS = ['.md', '.mdx', '.markdown'];

export async function activate(metadata: BayMetadata, state: BayState): Promise<void> {
  return activateWithRetry(metadata, state, 0);
}

async function activateWithRetry(
  metadata: BayMetadata,
  state: BayState,
  attempt: number
): Promise<void> {
  const maxAttempts = 2;

  try {
    // Determine if we should open in preview mode
    const config = vscode.workspace.getConfiguration('bays');
    const openPreviewableInPreview = config.get<boolean>('openPreviewableInPreview', true);
    
    // Auto-enable preview mode for previewable files if config is active
    const shouldOpenInPreview = 
      state.viewMode === 'preview' || 
      (openPreviewableInPreview && BayHelpers.isPreviewableFile(metadata));

    // MARKDOWN PREVIEW MODE: If should open in preview, open the preview
    if (
      shouldOpenInPreview &&
      metadata.uri &&
      MARKDOWN_EXTENSIONS.some((ext) => metadata.fileExtension.toLowerCase() === ext)
    ) {
      Logger.log('[BayAction] Activating in preview mode: ' + metadata.label);
      await vscode.commands.executeCommand(VSCODE_COMMANDS.MARKDOWN_SHOW_PREVIEW, metadata.uri);
      return;
    }

    // Re-buscar la bay nativa en cada intento (puede haber cambiado)
    const nativeTab = BayHelpers.findNativeTab(metadata, state);

    if (attempt === 0) {
      Logger.log(`[BayAction] Activating bay: ${metadata.label}, isPreview: ${state.isPreview}, viewMode: ${state.viewMode}, tabType: ${metadata.bayType}, nativeTabFound: ${!!nativeTab}, uri: ${metadata.uri?.toString()}`);
    }

    // Si la bay no existe después del primer intento completo, está cerrada
    if (!nativeTab && attempt > 0) {
      throw new Error(`Bay '${metadata.label}' no longer exists (closed or replaced)`);
    }

    // Para webview tabs, siempre usar el método nativo
    // Variants (with parentId) are also activated via native bay
    if (metadata.bayType === 'webview' || metadata.parentId) {
      return await BayHelpers.activateByNativeTab(metadata, state);
    }

    if (!metadata.uri) {
      return;
    }

    // Si la bay nativa existe, SIEMPRE usar activación por índice
    // (más confiable que showTextDocument, especialmente con preview tabs)
    if (nativeTab) {
      // Verificar que el URI coincide
      if (
        nativeTab.input instanceof vscode.TabInputText &&
        nativeTab.input.uri.toString() === metadata.uri.toString()
      ) {
        Logger.log('[BayAction] Using native activation by index for: ' + metadata.label);
        return await BayHelpers.activateByNativeTab(metadata, state);
      }
      // Si el URI no coincide, la bay fue reemplazada - continuar al fallback
      Logger.log('[BayAction] URI mismatch, bay was replaced: ' + metadata.label);
    }

    // La bay no existe o fue reemplazada - abrirla de nuevo
    // Usar workbench.action.openEditorAtIndex si hay una bay en esa posición
    if (nativeTab) {
      const tabIndex = nativeTab.group.tabs.indexOf(nativeTab);
      if (tabIndex !== -1) {
        Logger.log(`[BayAction] Activating by index (fallback): ${metadata.label}, index: ${tabIndex}`);
        await BayHelpers.focusGroup(state.viewColumn);
        await vscode.commands.executeCommand(VSCODE_COMMANDS.OPEN_EDITOR_AT_INDEX, tabIndex);
        return;
      }
    }

    // Fallback: abrir con showTextDocument
    Logger.log('[BayAction] Opening with showTextDocument (final fallback): ' + metadata.label);
    const doc = await vscode.workspace.openTextDocument(metadata.uri);
    await vscode.window.showTextDocument(doc, {
      viewColumn: state.viewColumn,
      preserveFocus: false,
      preview: false, // Abrir como permanente cuando reactivamos una bay cerrada
    });
  } catch (err) {
    // Si falla y es un intento temprano, esperar un poco y reintentar
    // (útil para race conditions con preview tabs)
    if (attempt < TIMINGS.ACTIVATION_MAX_RETRIES) {
      Logger.log(`[BayAction] Activation failed (attempt ${attempt + 1}/${TIMINGS.ACTIVATION_MAX_RETRIES + 1}), retrying: ${metadata.label}`);
      await new Promise((resolve) => setTimeout(resolve, TIMINGS.ACTIVATION_RETRY_DELAY));
      return activateWithRetry(metadata, state, attempt + 1);
    }

    // Último intento: usar vscode.open como fallback
    if (metadata.uri) {
      try {
        Logger.log('[BayAction] Using vscode.open as last resort: ' + metadata.label);
        await vscode.commands.executeCommand(VSCODE_COMMANDS.VSCODE_OPEN, metadata.uri, {
          viewColumn: state.viewColumn,
          preview: false,
        });
      } catch (finalErr) {
        Logger.error('[BayAction] Final activation attempt failed: ' + metadata.label, finalErr);
        throw finalErr;
      }
    }
  }
}
