/**
 * Cuánto hace, en la forma corta que cabe en una fila.
 *
 * Es pura y recibe el AHORA como argumento en vez de llamar a `Date.now()`
 * dentro: sin eso no hay forma de fijar los saltos con un test, y los saltos son
 * de lo que va esto. Cada escalón va al SUELO, así que 90 minutos son "1h" y no
 * "2h": lo que la fila dice es cuánto hace COMO MÍNIMO.
 */
export function relativeAge(timestamp: number, now: number = Date.now()): string {
  const seconds = Math.floor((now - timestamp) / 1000);

  // Un instante en el FUTURO contesta "just now" en vez de una distancia
  // negativa: el reloj de la máquina que escribió ese sello no es el nuestro, y
  // un minuto de desvío basta para que la fila diga "-1m".
  if (seconds < 60) { return 'just now'; }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) { return `${minutes}m ago`; }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) { return `${hours}h ago`; }

  return `${Math.floor(hours / 24)}d ago`;
}
