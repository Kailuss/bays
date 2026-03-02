/**
 * Ejemplo práctico: Extensión que añade funcionalidad de optimización de imágenes
 * usando los nuevos campos de SideTabActions
 * 
 * NOTA: Este es un ejemplo demostrativo. Algunos métodos del TabStateService
 * pueden necesitar ser implementados según tu arquitectura específica.
 */

import * as vscode from 'vscode';
import { SideTab } from '../models/SideTab';

/**
 * Verifica si una bay es una imagen.
 */
function isImageTab(bay: SideTab): boolean {
  const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];
  return imageExtensions.includes(bay.metadata.fileExtension.toLowerCase());
}

/**
 * Añade acción de optimización a una bay de imagen.
 * Demuestra uso de CustomActions.
 */
export function addImageOptimizationAction(bay: SideTab): void {
  bay.addCustomAction({
    id: 'optimize-image',
    label: 'Optimize Image',
    icon: 'zap',
    tooltip: 'Compress and optimize this image file',
    keybinding: 'Ctrl+Alt+O',
    execute: async (metadata, state) => {
      await optimizeImage(bay);
    },
  });

  // También añadir acción para info de imagen
  bay.addCustomAction({
    id: 'image-info',
    label: 'Image Info',
    icon: 'info',
    tooltip: 'Show image dimensions and size',
    execute: async (metadata, state) => {
      await showImageInfo(bay);
    },
  });
}

/**
 * Optimiza una imagen con feedback de progreso.
 * Demuestra uso de OperationState, Permissions y ActionContext.
 */
async function optimizeImage(bay: SideTab): Promise<void> {
  // 1. VERIFICAR PERMISOS
  if (!bay.state.permissions.canExport) {
    vscode.window.showWarningMessage('Export/optimization not allowed for this file');
    return;
  }

  if (bay.isActionRestricted('optimize-image')) {
    vscode.window.showWarningMessage('Image optimization is restricted');
    return;
  }

  // 2. VERIFICAR CAPACIDADES
  if (!bay.state.capabilities.canEdit) {
    vscode.window.showWarningMessage('Cannot modify read-only file');
    return;
  }

  if (!bay.metadata.uri) {
    return;
  }

  // 3. CAMBIAR A READONLY DURANTE PROCESAMIENTO
  const originalEditMode = bay.state.actionContext.editMode;
  bay.updateActionContext({ editMode: 'readonly' });

  // 4. INICIAR OPERACIÓN
  bay.startOperation('Optimizing image', true);

  try {
    // Simular optimización con progreso
    const steps = [
      { label: 'Reading file...', progress: 10 },
      { label: 'Analyzing image...', progress: 30 },
      { label: 'Compressing...', progress: 60 },
      { label: 'Saving optimized version...', progress: 90 },
    ];

    for (const step of steps) {
      // Verificar si el usuario canceló
      if (!bay.state.operationState.isProcessing) {
        vscode.window.showInformationMessage('Optimization cancelled');
        return;
      }

      vscode.window.showInformationMessage(step.label);
      bay.updateOperationProgress(step.progress);

      // Simular trabajo
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    // 5. OPERACIÓN COMPLETADA
    bay.updateOperationProgress(100);

    // 6. ACTUALIZAR ESTADO DE GIT (archivo modificado)
    bay.updateGitIntegration({
      hasUncommittedChanges: true,
    });

    vscode.window.showInformationMessage(`Image optimized: ${bay.metadata.label}`);

    // 7. OPCIONAL: Añadir a Copilot para documentar cambios
    const addToCopilot = await vscode.window.showQuickPick(['Yes', 'No'], {
      placeHolder: 'Add to Copilot Chat to document optimization?',
    });

    if (addToCopilot === 'Yes') {
      bay.addToCopilotContext();
    }
  } catch (error) {
    vscode.window.showErrorMessage(`Optimization failed: ${error}`);
  } finally {
    // 8. LIMPIAR
    bay.finishOperation();
    bay.updateActionContext({ editMode: originalEditMode });
  }
}

/**
 * Optimiza múltiples imágenes en batch.
 * Demuestra procesamiento batch con progreso agregado.
 */
async function optimizeMultipleImages(tabs: SideTab[]): Promise<void> {
  const confirm = await vscode.window.showQuickPick(['Yes', 'No'], {
    placeHolder: `Optimize ${tabs.length} images?`,
  });

  if (confirm !== 'Yes') {
    return;
  }

  let completed = 0;
  const total = tabs.length;

  // Crear progress notification
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Optimizing images',
      cancellable: true,
    },
    async (progress, token) => {
      for (const bay of tabs) {
        if (token.isCancellationRequested) {
          break;
        }

        // Iniciar operación individual
        bay.startOperation('Batch optimization', false);

        try {
          await optimizeImageQuick(bay);
          completed++;

          // Actualizar progreso global
          const percentage = (completed / total) * 100;
          progress.report({
            message: `${completed}/${total} images`,
            increment: 100 / total,
          });
        } catch (error) {
          console.error(`Failed to optimize ${bay.metadata.label}:`, error);
        } finally {
          bay.finishOperation();
        }
      }

      return completed;
    }
  );

  vscode.window.showInformationMessage(`Optimized ${completed}/${total} images`);
}

/**
 * Versión rápida de optimización sin UI feedback.
 */
async function optimizeImageQuick(bay: SideTab): Promise<void> {
  if (!bay.metadata.uri || !bay.state.permissions.canExport) {
    return;
  }

  // Simular optimización
  await new Promise((resolve) => setTimeout(resolve, 200));

  // Actualizar Git
  bay.updateGitIntegration({
    hasUncommittedChanges: true,
  });
}

/**
 * Muestra información de la imagen.
 * Demuestra ejecución de customAction.
 */
async function showImageInfo(bay: SideTab): Promise<void> {
  if (!bay.metadata.uri) {
    return;
  }

  try {
    const stats = await vscode.workspace.fs.stat(bay.metadata.uri);
    const sizeKB = (stats.size / 1024).toFixed(2);

    const info = [
      `File: ${bay.metadata.label}`,
      `Size: ${sizeKB} KB`,
      `Type: ${bay.metadata.fileExtension}`,
      `Modified: ${new Date(stats.mtime).toLocaleString()}`,
    ].join('\\n');

    vscode.window.showInformationMessage(info, { modal: true });
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to get image info: ${error}`);
  }
}

/**
 * Actualiza permisos de optimización según configuración.
 * Demuestra uso dinámico de Permissions.
 */
export function updateImagePermissions(allTabs: SideTab[]): void {
  const config = vscode.workspace.getConfiguration('bays.imageOptimization');
  const allowOptimization = config.get<boolean>('enabled', true);
  const protectedExtensions = config.get<string[]>('protectedExtensions', ['.svg']);

  for (const bay of allTabs) {
    if (isImageTab(bay)) {
      const isProtected = protectedExtensions.includes(bay.metadata.fileExtension.toLowerCase());

      bay.state.permissions = {
        ...bay.state.permissions,
        canExport: allowOptimization && !isProtected,
        canDelete: !isProtected,
        restrictedActions: isProtected ? ['optimize-image'] : [],
      };
    }
  }
}

/**
 * Ejemplo de uso desde el webview o UI.
 */
export async function handleImageActionFromUI(
  bay: SideTab,
  actionId: string
): Promise<void> {
  // Ejecutar acción personalizada
  await bay.executeCustomAction(actionId);
}
