import type { GitStatus } from '../models/BayTypes';
import type { BayStateCode } from '../shared/protocol';

/**
 * Lo que la fila necesita saber para decir su estado, y nada más.
 *
 * Se declara estructuralmente en vez de recibir una `Bay` porque aquélla arrastra
 * `vscode` y esto es una regla pura: con la forma estrecha, la precedencia se fija
 * con tests que corren sin extension host, y una `Bay` la satisface tal cual.
 */
export type BayStateFacts = {
  diagnosticSeverity?: number | null;
  gitStatus?: GitStatus;
  isDirty?: boolean;
};

/**
 * El CÓDIGO de estado de una fila, o `undefined` si está limpia.
 *
 * Lo que viaja al cliente es este código y no markup: el glifo, el título y la
 * clase que tiñe el nombre son presentación, y viven en `shared/bayState.ts`,
 * donde el cliente los dibuja. Lo que se decide aquí es la PRECEDENCIA, que es
 * lo único de esto que se puede romper sin que cambie nada visible hasta que un
 * fichero con un error deje de decirlo:
 *
 *   error > aviso > estado git > sin guardar > limpia
 */
export function bayStateCode(state: BayStateFacts): BayStateCode | undefined {
  if (state.diagnosticSeverity === 0) { return 'error'; }
  if (state.diagnosticSeverity === 1) { return 'warning'; }

  switch (state.gitStatus) {
    case 'modified'  : return 'modified';
    case 'added'     : return 'added';
    case 'deleted'   : return 'deleted';
    case 'untracked' : return 'untracked';
    case 'ignored'   : return 'ignored';
    case 'conflict'  : return 'conflict';
  }

  if (state.isDirty) { return 'dirty'; }

  return undefined;
}
