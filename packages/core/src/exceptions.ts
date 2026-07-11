/**
 * Deteccion determinista de excepciones E1..E13 y umbrales por defecto (dominio puro).
 *
 * FUENTE DE VERDAD: docs/specs/exceptions.md. Cada excepcion es una REGLA DETERMINISTA,
 * no un juicio del LLM (exceptions.md: "el agente esta disenado para no tomar decisiones
 * criticas en silencio"). Los umbrales viven en tabla `config` editable por superadmin
 * (exceptions.md §3); aqui se reciben como parametro `umbrales`. El tiempo entra como
 * parametro `ahora: Date` (nada de reloj oculto).
 *
 * ALCANCE: este modulo cubre las excepciones con deteccion puramente aritmetica/de umbral:
 * E1, E2, E4, E5, E9, E10, E12, E13. Las demas dependen de lookups/matching de datos y por
 * tanto NO son puras — se detectan fuera del core puro: E3 (match factura<->OC) y E6 (NC sin
 * match unico) en packages/db / worker; E7 (pedido sin proyecto), E8 (fuera de alcance) y
 * E11 (remitente desconocido) en el router del agente / apps/api. La lista completa E1..E13
 * vive en types.ts (CODIGOS_EXCEPCION).
 */

import type { CamposFacturaExtraida, EstadoPedido, UmbralesConfig } from './types.js';
import { puedeTransicionar } from './state-machine.js';

// ---------------------------------------------------------------------------
// Umbrales por defecto (exceptions.md §3; valores iniciales de la spec).
// ---------------------------------------------------------------------------

export const UMBRALES_DEFAULT: UmbralesConfig = {
  // E2
  confianzaMinCotizacion: 0.8,
  maxRepreguntasProveedor: 2,
  // E9
  confianzaMinFactura: 0.85,
  // E4
  difMontoRelMax: 0.01,
  difMontoAbsMinCRC: 10000,
  // E5: la spec no fija un numero ("diferencias menores (<= umbral)"). Default conservador
  // = 0 -> cualquier diferencia se marca (nunca se acepta un faltante en silencio) hasta que
  // superadmin configure una tolerancia. PREGUNTA ABIERTA de negocio (unidad depende del item).
  difCantidadMenor: 0,
  // RFQ / E1
  plazoCotizacionHorasDefault: 24,
  // E13
  horasAtascoEnRevision: 24,
  horasAtascoAprobado: 48,
  // E3: score minimo de `matchFacturaOc` para aceptar una OC como match unico de una factura
  // (exceptions.md fila E3 y regla general 3: "umbral_similitud_factura_oc"). Default 0.6.
  similitudMinFacturaOc: 0.6,
};

const MS_POR_HORA = 3_600_000;

/** Horas transcurridas entre dos instantes (puede ser fraccionaria o negativa). */
export function horasEntre(desde: Date, ahora: Date): number {
  return (ahora.getTime() - desde.getTime()) / MS_POR_HORA;
}

// ---------------------------------------------------------------------------
// E1 — Proveedor no responde cotizacion en plazo.
// ---------------------------------------------------------------------------

/**
 * E1: la cotizacion esta vencida si NO hay respuesta y ya se alcanzo/paso `plazoAt`.
 * Frontera: en el instante exacto de `plazoAt` se considera vencida (>=).
 */
export function cotizacionVencida(
  plazoAt: Date,
  ahora: Date,
  tieneRespuesta: boolean,
): boolean {
  if (tieneRespuesta) return false;
  return ahora.getTime() >= plazoAt.getTime();
}

// ---------------------------------------------------------------------------
// E2 — Cotizacion incompleta o ambigua.
// ---------------------------------------------------------------------------

/** Item extraido de una cotizacion (para evaluar completitud). */
export interface ItemCotizacionExtraido {
  readonly precioUnitario: number | null;
  readonly cantidad: number | null;
}

/** Falta precio o cantidad (ausente o no positivo => "sin precio/cantidad" de la spec). */
function itemIncompleto(it: ItemCotizacionExtraido): boolean {
  return (
    it.precioUnitario === null ||
    !(it.precioUnitario > 0) ||
    it.cantidad === null ||
    !(it.cantidad > 0)
  );
}

/**
 * E2: la cotizacion es incompleta si su confianza de extraccion esta bajo el umbral,
 * o si algun item carece de precio/cantidad (o no trae items).
 * Frontera de confianza: exactamente en el umbral NO es incompleta (spec: `< 0.8`).
 */
export function cotizacionIncompleta(
  items: readonly ItemCotizacionExtraido[],
  confianza: number,
  umbrales: UmbralesConfig,
): boolean {
  if (confianza < umbrales.confianzaMinCotizacion) return true;
  if (items.length === 0) return true;
  return items.some(itemIncompleto);
}

/**
 * E2: `true` si ya se alcanzo el maximo de repreguntas al proveedor y corresponde escalar.
 * `intentos` = repreguntas ya realizadas. Con maximo 2: intentos>=2 => escalar
 * (spec: "max. 2 intentos ...; al tercer fallo marca incompleta y escala").
 */
export function excedioRepreguntas(
  intentos: number,
  umbrales: UmbralesConfig,
): boolean {
  return intentos >= umbrales.maxRepreguntasProveedor;
}

// ---------------------------------------------------------------------------
// E4 — Factura con diferencia significativa de monto vs OC.
// ---------------------------------------------------------------------------

/**
 * E4: diferencia significativa si `abs(montoFactura - montoOC) > max(rel*montoOC, absMin)`.
 * Frontera: exactamente en el umbral NO es significativa (spec usa `>`).
 */
export function diferenciaMontoSignificativa(
  montoFactura: number,
  montoOC: number,
  umbrales: UmbralesConfig,
): boolean {
  const umbral = Math.max(
    umbrales.difMontoRelMax * Math.abs(montoOC),
    umbrales.difMontoAbsMinCRC,
  );
  return Math.abs(montoFactura - montoOC) > umbral;
}

// ---------------------------------------------------------------------------
// E9 — Extraccion OCR de factura bajo umbral.
// ---------------------------------------------------------------------------

/**
 * E9: confianza de extraccion bajo el umbral (spec: `< 0.85`).
 * Frontera: exactamente en el umbral NO es baja.
 */
export function extraccionBajaConfianza(
  confianza: number,
  umbrales: UmbralesConfig,
): boolean {
  return confianza < umbrales.confianzaMinFactura;
}

// ---------------------------------------------------------------------------
// E10 — Devolucion de equipo mayor que inventario activo.
// ---------------------------------------------------------------------------

/**
 * E10: la devolucion excede el inventario activo (spec: `devuelta > activa`).
 * Frontera: devolver exactamente lo activo NO excede (deja el alquiler en 0 y lo cierra).
 */
export function devolucionExcedeInventario(
  cantidadDevuelta: number,
  cantidadActiva: number,
): boolean {
  return cantidadDevuelta > cantidadActiva;
}

// ---------------------------------------------------------------------------
// E5 — Material recibido != ordenado.
// ---------------------------------------------------------------------------

export interface DiferenciaRecepcion {
  /** Hay cualquier diferencia entre lo ordenado y lo recibido. */
  readonly hayDiferencia: boolean;
  /** La diferencia es "menor" (<= umbral): se registra y notifica, pero no bloquea. */
  readonly esMenor: boolean;
}

/**
 * E5: compara cantidad ordenada vs recibida. `esMenor` es `true` solo cuando hay diferencia
 * y su magnitud es `<= difCantidadMenor`. Con el default 0, ninguna diferencia es "menor".
 */
export function diferenciaRecepcion(
  ordenado: number,
  recibido: number,
  umbrales: UmbralesConfig,
): DiferenciaRecepcion {
  const diff = Math.abs(ordenado - recibido);
  const hayDiferencia = diff > 0;
  const esMenor = hayDiferencia && diff <= umbrales.difCantidadMenor;
  return { hayDiferencia, esMenor };
}

// ---------------------------------------------------------------------------
// E13 — Pedido atascado.
// ---------------------------------------------------------------------------

/**
 * E13: `true` si el pedido lleva demasiado tiempo sin avanzar.
 * Spec: `>24h` en `en_revision` sin decision, o `>48h` en `aprobado` sin OC confirmada.
 * Otros estados no aplican. Fronteras estrictas (`>`): en el umbral exacto NO esta atascado.
 */
export function pedidoAtascado(
  estado: EstadoPedido,
  horasEnEstado: number,
  umbrales: UmbralesConfig,
): boolean {
  if (estado === 'en_revision') return horasEnEstado > umbrales.horasAtascoEnRevision;
  if (estado === 'aprobado') return horasEnEstado > umbrales.horasAtascoAprobado;
  return false;
}

/** E13 a partir de instantes: computa las horas y delega en `pedidoAtascado`. */
export function pedidoAtascadoDesde(
  estado: EstadoPedido,
  desde: Date,
  ahora: Date,
  umbrales: UmbralesConfig,
): boolean {
  return pedidoAtascado(estado, horasEntre(desde, ahora), umbrales);
}

// ---------------------------------------------------------------------------
// E12 — Transicion de estado invalida (usa la maquina de estados).
// ---------------------------------------------------------------------------

/** E12: `true` si la transicion `de -> a` no existe en la maquina de estados. */
export function transicionInvalida(de: EstadoPedido, a: EstadoPedido): boolean {
  return !puedeTransicionar(de, a).ok;
}

// ---------------------------------------------------------------------------
// E9 — Extraccion OCR de factura bajo umbral, por campo.
// ---------------------------------------------------------------------------

/** Campos criticos de `CamposFacturaExtraida`: dudosos en estos disparan E9 por si solos. */
const CAMPOS_FACTURA_CRITICOS: readonly (keyof CamposFacturaExtraida)[] = [
  'numeroFactura',
  'montoTotal',
];

/** Orden canonico de campos evaluados (determinista, no depende de `Object.keys`). */
const CAMPOS_FACTURA: readonly (keyof CamposFacturaExtraida)[] = [
  'numeroFactura',
  'montoTotal',
  'fecha',
  'proveedorNombre',
];

export interface EvaluacionExtraccionFactura {
  /** Campos con `confianza < umbrales.confianzaMinFactura`, en el orden de `CAMPOS_FACTURA`. */
  readonly camposDudosos: readonly (keyof CamposFacturaExtraida)[];
  /** `true` si algun campo CRITICO (numeroFactura o montoTotal) quedo dudoso. */
  readonly disparaE9: boolean;
}

/**
 * E9 por campo (exceptions.md fila E9): evalua la confianza de cada campo extraido de una
 * factura contra `umbrales.confianzaMinFactura`. Un campo es "dudoso" si su confianza esta
 * bajo el umbral (misma frontera que `extraccionBajaConfianza`: exactamente en el umbral NO
 * es dudoso). `disparaE9` es `true` solo si `numeroFactura` o `montoTotal` (los campos
 * criticos) quedan dudosos: "E9 dispara si confianza < 0.85 en numero de factura o cualquier
 * monto". `fecha`/`proveedorNombre` se reportan en `camposDudosos` (para pedir confirmacion
 * campo-por-campo al bodeguero) pero NO disparan E9 por si solos.
 */
export function evaluarExtraccionFactura(
  campos: CamposFacturaExtraida,
  umbrales: UmbralesConfig,
): EvaluacionExtraccionFactura {
  const camposDudosos = CAMPOS_FACTURA.filter((campo) =>
    extraccionBajaConfianza(campos[campo].confianza, umbrales),
  );
  const disparaE9 = camposDudosos.some((campo) => CAMPOS_FACTURA_CRITICOS.includes(campo));
  return { camposDudosos, disparaE9 };
}

// ---------------------------------------------------------------------------
// E13 — Reincidencia de recordatorios (escala tambien a superadmin).
// ---------------------------------------------------------------------------

/**
 * E13 reincidencia (exceptions.md fila E13): `true` si el recordatorio que se va a emitir
 * seria el 2.º o posterior desde el ultimo cambio de estado del pedido — es decir, ya hubo
 * al menos 1 recordatorio previo. Cuando es reincidente, la notificacion escala tambien a
 * superadmin (Gerencia), ademas de a Proveeduria.
 */
export function esRecordatorioReincidente(recordatoriosPreviosDesdeUltimoCambio: number): boolean {
  return recordatoriosPreviosDesdeUltimoCambio >= 1;
}

// ---------------------------------------------------------------------------
// Ciclo de alquiler de equipos (state-machine.md §4.4).
// ---------------------------------------------------------------------------

/**
 * `true` si el alquiler debe cerrarse automaticamente: `cantidad_activa` llego a 0 tras una
 * devolucion (state-machine.md §4.4: "`cerrado` | `cantidad_activa == 0` tras devoluciones
 * (Sistema, automatico)").
 *
 * `cantidadActiva` negativa es un invariante imposible: la spec dice "nunca puede quedar
 * negativa (rechazar y escalar)" y el CHECK de la base de datos lo impide antes de que este
 * dato llegue aqui. Por convencion del paquete se lanza (bug upstream), no `Result` (que es
 * para validaciones de flujo normal / entrada de usuario).
 */
export function alquilerDebeCerrarse(cantidadActiva: number): boolean {
  if (cantidadActiva < 0) {
    throw new RangeError(
      `cantidadActiva no puede ser negativa (recibido: ${cantidadActiva}); invariante ` +
        'violado (el CHECK de la base de datos deberia impedirlo antes de llegar aqui).',
    );
  }
  return cantidadActiva === 0;
}
