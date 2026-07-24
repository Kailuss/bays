import { Bay } from './Bay';
import * as vscode from 'vscode';

/**
 * Paleta con la que se tiñe un grupo. Cada id se traduce en `group-header.css`
 * a un `--vscode-charts-*`, así que el color sigue siendo nativo del tema activo
 * (claro u oscuro) en lugar de un hex fijo.
 */
export const GROUP_COLORS = ['blue', 'green', 'yellow', 'orange', 'red', 'purple'] as const;

export type BayGroupColor = typeof GROUP_COLORS[number];

/**
 * Todo grupo tiene color: si el usuario no ha elegido uno, se reparte la paleta
 * por columna, de modo que dos grupos contiguos nunca coinciden.
 * (Con un solo grupo el color existe pero no se pinta — no distingue nada.)
 */
export function defaultGroupColor(viewColumn: number): BayGroupColor {
  return GROUP_COLORS[Math.max(0, viewColumn - 1) % GROUP_COLORS.length];
}

/** Represents an editor group containing multiple bays. */
export type BayGroup = {
  id         : number;
  viewColumn : vscode.ViewColumn;
  isActive   : boolean;
  bays       : Bay[];
  /** Nombre por defecto derivado de la columna ("Group 1"). */
  label      : string;
  /** Nombre asignado por el usuario; sustituye a `label` cuando existe. */
  customLabel?: string;
  /** Siempre presente: el elegido por el usuario o el derivado de la columna. */
  color      : BayGroupColor;
  /** Un grupo bloqueado oculta todo lo que cierra: la X de cada bay y "Close Group". */
  isLocked   : boolean;
};

/**
 * Creates a BayGroup from a VS Code TabGroup.
 * Tabs are populated separately by the sync service.
 *
 * Nace siempre sin personalizar: `GroupCustomizationService` reaplica nombre,
 * color y bloqueo después de cada sync (que reconstruye los grupos desde cero).
 */
export function createTabGroup(group: vscode.TabGroup): BayGroup {
  return {
    id         : group.viewColumn,
    viewColumn : group.viewColumn,
    isActive   : group.isActive,
    bays       : [],
    label      : `Group ${group.viewColumn}`,
    color      : defaultGroupColor(group.viewColumn),
    isLocked   : false,
  };
}

/** Nombre a mostrar en la cabecera: el del usuario, o el derivado por defecto. */
export function getGroupLabel(group: BayGroup): string {
  return group.customLabel?.trim() || group.label;
}
