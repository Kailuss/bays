import * as vscode from 'vscode';

/**
 * Logger central que escribe en el canal de salida "Bays".
 * Usar para mensajes importantes y errores (no para traza detallada).
 */
export class Logger {
  private static outputChannel: vscode.OutputChannel;

  /** Crea el canal de salida. Llamar una vez desde `activate()`. */
  static initialize(): void {
    this.outputChannel = vscode.window.createOutputChannel('Bays');
  }

  /** Registra un mensaje informativo con marca temporal. */
  static log(message: string): void {
    const timestamp = new Date().toISOString();
    this.outputChannel.appendLine(`[${timestamp}] ${message}`);
  }

  /** Registra una advertencia. */
  static warn(message: string): void {
    this.log(`WARN: ${message}`);
  }

  /** Registra un error; si hay objeto Error también escribe su stack. */
  static error(message: string, error?: unknown): void {
    this.log(`ERROR: ${message}`);
    if (error instanceof Error) {
      this.log(error.message);
      if (error.stack) {
        this.log(error.stack);
      }
    }
  }

  /** Muestra el canal de salida en la UI. */
  static show(): void {
    this.outputChannel.show();
  }
} 
