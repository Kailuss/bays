import * as vscode from 'vscode';
import { Logger }  from '../../utils/logger';
import { 
  FileQuickAction, 
  DynamicFileQuickAction,
  ResolvedQuickAction, 
  FileActionContext,
  BUILTIN_ACTIONS,
  DYNAMIC_ACTIONS 
} from '../../constants/fileQuickActions/index';

// Re-export for consumers that import from this module
export type { FileQuickAction, ResolvedQuickAction, FileActionContext } from '../../constants/fileQuickActions/index';

// ──────────────────────────────── Registry ─────────────────────────────────────

/**
 * Registry for file type quick actions.
 * Evaluates in registration order (first match wins).
 * Dynamic actions resolve icon/tooltip based on bay context.
 */
export class FileActionRegistry {

  /** Acciones añadidas por el usuario / otros módulos (mayor prioridad). */
  private custom: FileQuickAction[] = [];

  /** Acciones predefinidas estáticas (menor prioridad). */
  private builtin: FileQuickAction[] = [...BUILTIN_ACTIONS];

  /** Acciones dinámicas que se resuelven según contexto (mayor prioridad que estáticas). */
  private dynamic: DynamicFileQuickAction[] = [...DYNAMIC_ACTIONS];

  /** Registra una acción personalizada (se evalúa antes que las built-in). */
  register(action: FileQuickAction): void {
    this.custom.push(action);
  }

  /** Elimina una acción por su id. */
  unregister(id: string): void {
    this.custom  = this.custom.filter(a => a.id !== id);
    this.builtin = this.builtin.filter(a => a.id !== id);
    this.dynamic = this.dynamic.filter(a => a.id !== id);
  }

  /**
   * Resuelve la acción contextual para un archivo.
   * Devuelve la primera acción cuyo `match` sea `true`, o `null` si
   * ninguna aplica (el botón no se mostrará).
   * 
   * @param fileName - Nombre del archivo (basename)
   * @param uri - URI completa del archivo
   * @param context - Contexto opcional de la bay (viewMode, etc.)
   */
  resolve(fileName: string, uri: vscode.Uri, context?: FileActionContext): ResolvedQuickAction | null {
    // Dynamic actions first (they depend on bay state)
    for (const action of this.dynamic) {
      if (action.match(fileName, uri)) {
        const resolved = action.resolve(context);
        return { 
          id: resolved.actionId, 
          icon: resolved.icon, 
          tooltip: resolved.tooltip,
          setFocus: action.setFocus ?? false,
        };
      }
    }
    // Custom static actions
    for (const action of this.custom) {
      if (action.match(fileName, uri)) {
        return { 
          id: action.id, 
          icon: action.icon, 
          tooltip: action.tooltip,
          setFocus: action.setFocus ?? true,
        };
      }
    }
    // Then built-in static
    for (const action of this.builtin) {
      if (action.match(fileName, uri)) {
        return { 
          id: action.id, 
          icon: action.icon, 
          tooltip: action.tooltip,
          setFocus: action.setFocus ?? false,
        };
      }
    }
    return null;
  }

  /**
   * Ejecuta la acción asociada a un archivo (buscada por id).
   * Devuelve `true` si se ejecutó, `false` si no se encontró.
   * 
   * @param actionId - ID de la acción a ejecutar
   * @param uri - URI del archivo
   * @param context - Contexto opcional de la bay
   */
  async execute(actionId: string, uri: vscode.Uri, context?: FileActionContext): Promise<boolean> {
    // Check dynamic actions first (they have context-aware execute)
    for (const action of this.dynamic) {
      const resolved = action.resolve(context);
      if (resolved.actionId === actionId) {
        try {
          await action.execute(uri, context);
          return true;
        } catch (error) {
          Logger.error(`[FileAction] Failed to execute dynamic "${actionId}":`, error);
          return false;
        }
      }
    }

    // Static actions
    const action =
      this.custom.find(a => a.id === actionId) ??
      this.builtin.find(a => a.id === actionId);

    if (!action) { return false; }

    try {
      await action.execute(uri);
      return true;
    } catch (error) {
      Logger.error(`[FileAction] Failed to execute "${actionId}":`, error);
      return false;
    }
  }

  /** Devuelve todas las acciones registradas (para depuración). */
  getAll(): ReadonlyArray<FileQuickAction> {
    return [...this.custom, ...this.builtin];
  }

  /**
   * Devuelve si una acción debe hacer focus o no.
   * @param actionId - ID de la acción
   * @returns true si debe hacer focus, false si no (default)
   */
  shouldSetFocus(actionId: string): boolean {
    // Check dynamic actions
    const dynamicAction = this.dynamic.find(a => a.id === actionId);
    if (dynamicAction) {
      return dynamicAction.setFocus ?? false;
    }

    // Check static actions
    const action = this.custom.find(a => a.id === actionId) ?? this.builtin.find(a => a.id === actionId);
    return action?.setFocus ?? false;
  }
}
