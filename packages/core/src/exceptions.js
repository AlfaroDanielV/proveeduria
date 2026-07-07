/**
 * Deteccion determinista de excepciones E1..E13 y umbrales por defecto (dominio puro).
 *
 * FUENTE DE VERDAD: docs/specs/exceptions.md. Cada excepcion es una REGLA DETERMINISTA,
 * no un juicio del LLM (exceptions.md: "el agente esta disenado para no tomar decisiones
 * criticas en silencio"). Los umbrales viven en tabla `config` editable por superadmin
 * (exceptions.md §3); aqui se reciben como parametro `umbrales`. El tiempo entra como
 * parametro `ahora: Date` (nada de reloj oculto).
 */
import { puedeTransicionar } from './state-machine.js';
// ---------------------------------------------------------------------------
// Umbrales por defecto (exceptions.md §3; valores iniciales de la spec).
// ---------------------------------------------------------------------------
export const UMBRALES_DEFAULT = {
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
};
const MS_POR_HORA = 3_600_000;
/** Horas transcurridas entre dos instantes (puede ser fraccionaria o negativa). */
export function horasEntre(desde, ahora) {
    return (ahora.getTime() - desde.getTime()) / MS_POR_HORA;
}
// ---------------------------------------------------------------------------
// E1 — Proveedor no responde cotizacion en plazo.
// ---------------------------------------------------------------------------
/**
 * E1: la cotizacion esta vencida si NO hay respuesta y ya se alcanzo/paso `plazoAt`.
 * Frontera: en el instante exacto de `plazoAt` se considera vencida (>=).
 */
export function cotizacionVencida(plazoAt, ahora, tieneRespuesta) {
    if (tieneRespuesta)
        return false;
    return ahora.getTime() >= plazoAt.getTime();
}
/** Falta precio o cantidad (ausente o no positivo => "sin precio/cantidad" de la spec). */
function itemIncompleto(it) {
    return (it.precioUnitario === null ||
        !(it.precioUnitario > 0) ||
        it.cantidad === null ||
        !(it.cantidad > 0));
}
/**
 * E2: la cotizacion es incompleta si su confianza de extraccion esta bajo el umbral,
 * o si algun item carece de precio/cantidad (o no trae items).
 * Frontera de confianza: exactamente en el umbral NO es incompleta (spec: `< 0.8`).
 */
export function cotizacionIncompleta(items, confianza, umbrales) {
    if (confianza < umbrales.confianzaMinCotizacion)
        return true;
    if (items.length === 0)
        return true;
    return items.some(itemIncompleto);
}
/**
 * E2: `true` si ya se alcanzo el maximo de repreguntas al proveedor y corresponde escalar.
 * `intentos` = repreguntas ya realizadas. Con maximo 2: intentos>=2 => escalar
 * (spec: "max. 2 intentos ...; al tercer fallo marca incompleta y escala").
 */
export function excedioRepreguntas(intentos, umbrales) {
    return intentos >= umbrales.maxRepreguntasProveedor;
}
// ---------------------------------------------------------------------------
// E4 — Factura con diferencia significativa de monto vs OC.
// ---------------------------------------------------------------------------
/**
 * E4: diferencia significativa si `abs(montoFactura - montoOC) > max(rel*montoOC, absMin)`.
 * Frontera: exactamente en el umbral NO es significativa (spec usa `>`).
 */
export function diferenciaMontoSignificativa(montoFactura, montoOC, umbrales) {
    const umbral = Math.max(umbrales.difMontoRelMax * Math.abs(montoOC), umbrales.difMontoAbsMinCRC);
    return Math.abs(montoFactura - montoOC) > umbral;
}
// ---------------------------------------------------------------------------
// E9 — Extraccion OCR de factura bajo umbral.
// ---------------------------------------------------------------------------
/**
 * E9: confianza de extraccion bajo el umbral (spec: `< 0.85`).
 * Frontera: exactamente en el umbral NO es baja.
 */
export function extraccionBajaConfianza(confianza, umbrales) {
    return confianza < umbrales.confianzaMinFactura;
}
// ---------------------------------------------------------------------------
// E10 — Devolucion de equipo mayor que inventario activo.
// ---------------------------------------------------------------------------
/**
 * E10: la devolucion excede el inventario activo (spec: `devuelta > activa`).
 * Frontera: devolver exactamente lo activo NO excede (deja el alquiler en 0 y lo cierra).
 */
export function devolucionExcedeInventario(cantidadDevuelta, cantidadActiva) {
    return cantidadDevuelta > cantidadActiva;
}
/**
 * E5: compara cantidad ordenada vs recibida. `esMenor` es `true` solo cuando hay diferencia
 * y su magnitud es `<= difCantidadMenor`. Con el default 0, ninguna diferencia es "menor".
 */
export function diferenciaRecepcion(ordenado, recibido, umbrales) {
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
export function pedidoAtascado(estado, horasEnEstado, umbrales) {
    if (estado === 'en_revision')
        return horasEnEstado > umbrales.horasAtascoEnRevision;
    if (estado === 'aprobado')
        return horasEnEstado > umbrales.horasAtascoAprobado;
    return false;
}
/** E13 a partir de instantes: computa las horas y delega en `pedidoAtascado`. */
export function pedidoAtascadoDesde(estado, desde, ahora, umbrales) {
    return pedidoAtascado(estado, horasEntre(desde, ahora), umbrales);
}
// ---------------------------------------------------------------------------
// E12 — Transicion de estado invalida (usa la maquina de estados).
// ---------------------------------------------------------------------------
/** E12: `true` si la transicion `de -> a` no existe en la maquina de estados. */
export function transicionInvalida(de, a) {
    return !puedeTransicionar(de, a).ok;
}
//# sourceMappingURL=exceptions.js.map