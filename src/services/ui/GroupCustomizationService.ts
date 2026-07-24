import * as vscode from 'vscode';
import { BayGroup, BayGroupColor, defaultGroupColor } from '../../models/BayGroup';
import { Logger } from '../../utils/logger';

const STORAGE_KEY = 'bays.groupCustomizations';

/** Lo que el usuario puede personalizar de un grupo. Todo opcional: una entrada
 *  vacía se borra del almacén en lugar de guardarse con valores por defecto. */
export type GroupCustomization = {
  label ?: string;
  /** Sin valor = automático: el color derivado de la columna. */
  color ?: BayGroupColor;
  locked?: boolean;
};

/**
 * Persiste nombre, color y bloqueo por grupo en el `workspaceState`.
 *
 * La clave es el `viewColumn`. VS Code no expone ningún identificador estable de
 * grupo de editores, así que al cerrar un split las columnas se renumeran y la
 * personalización se queda con la columna, no con el grupo que la tenía. Es la
 * única clave disponible con la API pública.
 */
export class GroupCustomizationService {
  private data: Record<string, GroupCustomization>;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.data = { ...context.workspaceState.get<Record<string, GroupCustomization>>(STORAGE_KEY, {}) };
  }

  get(groupId: number): GroupCustomization | undefined {
    return this.data[String(groupId)];
  }

  /**
   * Vuelca la personalización almacenada sobre un grupo recién construido.
   * Siempre escribe los tres campos: un grupo reciclado no puede quedarse con
   * el color o el bloqueo del anterior ocupante de esa columna.
   */
  apply(group: BayGroup): void {
    const custom      = this.get(group.id);
    group.customLabel = custom?.label;
    group.color       = custom?.color  ?? defaultGroupColor(group.viewColumn);
    group.isLocked    = custom?.locked ?? false;
  }

  setLabel(groupId: number, label: string | undefined): Promise<void> {
    return this.patch(groupId, { label: label?.trim() || undefined });
  }

  /** `undefined` devuelve el grupo al color automático de su columna. */
  setColor(groupId: number, color: BayGroupColor | undefined): Promise<void> {
    return this.patch(groupId, { color });
  }

  setLocked(groupId: number, locked: boolean): Promise<void> {
    return this.patch(groupId, { locked: locked || undefined });
  }

  /** Aplica un parche y poda las claves vacías para no acumular ruido. */
  private async patch(groupId: number, patch: GroupCustomization): Promise<void> {
    const key  = String(groupId);
    const next = { ...this.data[key], ...patch };

    for (const field of Object.keys(next) as (keyof GroupCustomization)[]) {
      if (next[field] === undefined) { delete next[field]; }
    }

    if (Object.keys(next).length === 0) { delete this.data[key]; }
    else                                { this.data[key] = next; }

    await this.persist();
  }

  private async persist(): Promise<void> {
    try {
      await this.context.workspaceState.update(STORAGE_KEY, this.data);
    } catch (err) {
      Logger.error('[GroupCustomization] Failed to persist group customizations', err);
    }
  }
}
