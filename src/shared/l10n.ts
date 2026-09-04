// La interpolación de placeholders de los mensajes localizables, compartida por
// los dos lados.
//
// El formato es el que usa `vscode.l10n.t` (`{0}`, `{1}`…), así que toda cadena
// visible del codebase lleva sus argumentos igual la formatee quien la formatee:
// el host le entrega el patrón a `vscode.l10n.t`, que lo busca en el bundle
// cargado e interpola por su cuenta, y el cliente —que no alcanza `vscode`— lo
// busca en el bundle que el shell le inyectó e interpola aquí. Dos formatos
// serían el mismo mensaje escrito dos veces, una por lado, y los dos separándose.
//
// Sin imports: compila en los DOS proyectos de TypeScript (ni `vscode`, ni DOM).

/**
 * Sustituye `{n}` por el n-ésimo argumento.
 *
 * Un índice sin argumento se deja TAL CUAL escrito en vez de convertirse en
 * "undefined": una traducción con un placeholder de más enseña entonces dónde
 * está el hueco en vez de esconderlo.
 */
export function interpolate(message: string, ...args: Array<string | number>): string {
  return message.replace(/\{(\d+)\}/g, (match, index) => {
    const arg = args[Number(index)];
    return arg === undefined ? match : String(arg);
  });
}
