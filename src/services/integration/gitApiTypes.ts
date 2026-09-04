// El API de la extensión `vscode.git`, la PARTE que se usa, declarada UNA vez.
//
// Esa extensión no publica tipos que se puedan importar: lo que devuelve
// `getExtension('vscode.git')?.exports.getAPI(1)` es un objeto sin forma. La
// respuesta no es `any` — con él, un campo renombrado aguas arriba compila y
// falla en ejecución, en silencio y solo para quien tenga ese repositorio — sino
// declarar aquí lo que se lee y no leer nada más.
//
// Es deliberadamente estrecho: cada campo de aquí es uno del que este código
// depende, así que la lista es también la respuesta a "qué se rompe si el API
// cambia".

import type * as vscode from 'vscode';

/** El código de estado de un cambio, tal y como lo numera la extensión de git. */
export type GitChangeStatus = number;

/** Un fichero cambiado, en cualquiera de las tres listas de un repositorio. */
export type GitChange = {
  uri          : vscode.Uri;
  /** De dónde venía en un renombrado; ausente en el resto. */
  originalUri? : vscode.Uri;
  status       : GitChangeStatus;
};

/**
 * El estado vivo de un repositorio. `onDidChange` es lo que se escucha en vez de
 * lanzar `git status`: la extensión de git ya lo mantiene al día.
 */
export type GitRepositoryState = {
  workingTreeChanges : GitChange[];
  indexChanges       : GitChange[];
  mergeChanges       : GitChange[];
  onDidChange        : vscode.Event<void>;
};

export type GitRepository = {
  rootUri : vscode.Uri;
  state   : GitRepositoryState;
};

/** La raíz del API, versión 1. */
export type GitApi = {
  repositories        : GitRepository[];
  onDidOpenRepository : vscode.Event<GitRepository>;
  onDidCloseRepository: vscode.Event<GitRepository>;
};

/** Lo que exporta la extensión: una fábrica versionada. */
export type GitExtensionExports = {
  getAPI(version: 1): GitApi;
};
