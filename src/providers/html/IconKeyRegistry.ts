import { iconMarkerToHtml, placeholderIconHtml } from '../../utils/iconHtml';

/**
 * Le da a cada icono una clave corta y estable, para que su HTML viaje UNA vez
 * por mensaje en vez de una vez por fila.
 *
 * Sin esto, diez pestañas `.ts` mandan diez copias del mismo SVG, y el marcador
 * de un tema es un `data:` URI que se cuenta en kilobytes. Con esto van diez
 * referencias a una entrada de diccionario.
 *
 * Las claves son estables durante la vida del tema, así que las filas ya
 * pintadas se pueden parchear sin renumerar nada. Un cambio de tema las
 * invalida todas: los marcadores que tiene el cliente son del tema anterior.
 */
export class IconKeyRegistry {
  /** marcador → clave. */
  private keys = new Map<string, string>();
  /** clave → HTML. */
  private html = new Map<string, string>();
  private next = 0;

  /** Marcador sintético de "todavía sin resolver": se pinta como el placeholder. */
  static readonly PLACEHOLDER = '@placeholder';

  /** La clave de un marcador, acuñada la primera vez que se ve. */
  keyFor(marker: string): string {
    return this.mint(
      marker,
      () => marker === IconKeyRegistry.PLACEHOLDER ? placeholderIconHtml() : iconMarkerToHtml(marker),
    );
  }

  /**
   * Una clave con HTML ya resuelto, para lo que no pasa por un marcador de tema:
   * el logo de la extensión dueña de un webview, o un codicon de reserva.
   *
   * Se indexa por el propio HTML, que es lo que la hace deduplicar igual que la
   * otra puerta: todas las pestañas de Claude Code comparten una entrada. El
   * prefijo la mantiene en el mismo mapa sin poder chocar con un marcador de
   * tema, que nunca empieza así.
   */
  keyForHtml(html: string): string {
    return this.mint(`@html:${html}`, () => html);
  }

  private mint(cacheKey: string, resolve: () => string): string {
    let key = this.keys.get(cacheKey);
    if (key === undefined) {
      key = `i${this.next++}`;
      this.keys.set(cacheKey, key);
      this.html.set(key, resolve());
    }
    return key;
  }

  /** El diccionario entero, tal y como viaja en el mensaje. */
  dictionary(): Record<string, string> {
    return Object.fromEntries(this.html);
  }

  /** Al cambiar el tema, los marcadores que tiene el cliente ya no valen. */
  clear(): void {
    this.keys.clear();
    this.html.clear();
    this.next = 0;
  }
}
