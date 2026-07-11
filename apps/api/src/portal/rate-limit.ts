/**
 * Rate limit basico de login por IP + identificador (docs/specs/control-center.md
 * §Autenticacion). En memoria y por proceso: suficiente para la instancia unica del
 * Modulo 1; si api escala horizontal, migrar a un contador compartido (Postgres/Redis)
 * — documentado aqui a proposito para que no se olvide.
 *
 * Ventana fija por clave: `maxIntentos` fallos dentro de `ventanaMs` bloquean la clave
 * hasta que la ventana vence. Un login exitoso limpia la clave. El reloj se recibe por
 * parametro (convencion del monorepo; testeable sin timers).
 */

export interface OpcionesLimitador {
  readonly maxIntentos: number;
  readonly ventanaMs: number;
}

interface EntradaLimitador {
  count: number;
  venceAt: number;
}

/** Umbral de limpieza oportunista para acotar memoria ante claves basura (scan de IPs). */
const MAX_ENTRADAS_ANTES_DE_PURGA = 10_000;

export class LimitadorIntentos {
  private readonly fallos = new Map<string, EntradaLimitador>();

  constructor(private readonly opciones: OpcionesLimitador) {}

  /** `true` si la clave agoto sus intentos dentro de la ventana vigente. */
  bloqueado(clave: string, ahora: Date): boolean {
    const entrada = this.fallos.get(clave);
    if (entrada === undefined) return false;
    if (entrada.venceAt <= ahora.getTime()) {
      this.fallos.delete(clave);
      return false;
    }
    return entrada.count >= this.opciones.maxIntentos;
  }

  registrarFallo(clave: string, ahora: Date): void {
    if (this.fallos.size > MAX_ENTRADAS_ANTES_DE_PURGA) {
      this.purgarVencidas(ahora);
    }
    const entrada = this.fallos.get(clave);
    if (entrada === undefined || entrada.venceAt <= ahora.getTime()) {
      this.fallos.set(clave, {
        count: 1,
        venceAt: ahora.getTime() + this.opciones.ventanaMs,
      });
      return;
    }
    entrada.count += 1;
  }

  registrarExito(clave: string): void {
    this.fallos.delete(clave);
  }

  private purgarVencidas(ahora: Date): void {
    for (const [clave, entrada] of this.fallos) {
      if (entrada.venceAt <= ahora.getTime()) this.fallos.delete(clave);
    }
  }
}

/** Par de limitadores del login (claves independientes por identificador y por IP). */
export interface LimitadorLogin {
  readonly porIdentificador: LimitadorIntentos;
  readonly porIp: LimitadorIntentos;
}

/** Defaults: 5 fallos/15min por identificador; 20 fallos/15min por IP. */
export function crearLimitadorLogin(): LimitadorLogin {
  const ventanaMs = 15 * 60_000;
  return {
    porIdentificador: new LimitadorIntentos({ maxIntentos: 5, ventanaMs }),
    porIp: new LimitadorIntentos({ maxIntentos: 20, ventanaMs }),
  };
}
