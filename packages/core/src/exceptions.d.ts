/**
 * Deteccion determinista de excepciones E1..E13 y umbrales por defecto (dominio puro).
 *
 * FUENTE DE VERDAD: docs/specs/exceptions.md. Cada excepcion es una REGLA DETERMINISTA,
 * no un juicio del LLM (exceptions.md: "el agente esta disenado para no tomar decisiones
 * criticas en silencio"). Los umbrales viven en tabla `config` editable por superadmin
 * (exceptions.md §3); aqui se reciben como parametro `umbrales`. El tiempo entra como
 * parametro `ahora: Date` (nada de reloj oculto).
 */
import type { EstadoPedido, UmbralesConfig } from './types.js';
export declare const UMBRALES_DEFAULT: UmbralesConfig;
/** Horas transcurridas entre dos instantes (puede ser fraccionaria o negativa). */
export declare function horasEntre(desde: Date, ahora: Date): number;
/**
 * E1: la cotizacion esta vencida si NO hay respuesta y ya se alcanzo/paso `plazoAt`.
 * Frontera: en el instante exacto de `plazoAt` se considera vencida (>=).
 */
export declare function cotizacionVencida(plazoAt: Date, ahora: Date, tieneRespuesta: boolean): boolean;
/** Item extraido de una cotizacion (para evaluar completitud). */
export interface ItemCotizacionExtraido {
    readonly precioUnitario: number | null;
    readonly cantidad: number | null;
}
/**
 * E2: la cotizacion es incompleta si su confianza de extraccion esta bajo el umbral,
 * o si algun item carece de precio/cantidad (o no trae items).
 * Frontera de confianza: exactamente en el umbral NO es incompleta (spec: `< 0.8`).
 */
export declare function cotizacionIncompleta(items: readonly ItemCotizacionExtraido[], confianza: number, umbrales: UmbralesConfig): boolean;
/**
 * E2: `true` si ya se alcanzo el maximo de repreguntas al proveedor y corresponde escalar.
 * `intentos` = repreguntas ya realizadas. Con maximo 2: intentos>=2 => escalar
 * (spec: "max. 2 intentos ...; al tercer fallo marca incompleta y escala").
 */
export declare function excedioRepreguntas(intentos: number, umbrales: UmbralesConfig): boolean;
/**
 * E4: diferencia significativa si `abs(montoFactura - montoOC) > max(rel*montoOC, absMin)`.
 * Frontera: exactamente en el umbral NO es significativa (spec usa `>`).
 */
export declare function diferenciaMontoSignificativa(montoFactura: number, montoOC: number, umbrales: UmbralesConfig): boolean;
/**
 * E9: confianza de extraccion bajo el umbral (spec: `< 0.85`).
 * Frontera: exactamente en el umbral NO es baja.
 */
export declare function extraccionBajaConfianza(confianza: number, umbrales: UmbralesConfig): boolean;
/**
 * E10: la devolucion excede el inventario activo (spec: `devuelta > activa`).
 * Frontera: devolver exactamente lo activo NO excede (deja el alquiler en 0 y lo cierra).
 */
export declare function devolucionExcedeInventario(cantidadDevuelta: number, cantidadActiva: number): boolean;
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
export declare function diferenciaRecepcion(ordenado: number, recibido: number, umbrales: UmbralesConfig): DiferenciaRecepcion;
/**
 * E13: `true` si el pedido lleva demasiado tiempo sin avanzar.
 * Spec: `>24h` en `en_revision` sin decision, o `>48h` en `aprobado` sin OC confirmada.
 * Otros estados no aplican. Fronteras estrictas (`>`): en el umbral exacto NO esta atascado.
 */
export declare function pedidoAtascado(estado: EstadoPedido, horasEnEstado: number, umbrales: UmbralesConfig): boolean;
/** E13 a partir de instantes: computa las horas y delega en `pedidoAtascado`. */
export declare function pedidoAtascadoDesde(estado: EstadoPedido, desde: Date, ahora: Date, umbrales: UmbralesConfig): boolean;
/** E12: `true` si la transicion `de -> a` no existe en la maquina de estados. */
export declare function transicionInvalida(de: EstadoPedido, a: EstadoPedido): boolean;
//# sourceMappingURL=exceptions.d.ts.map