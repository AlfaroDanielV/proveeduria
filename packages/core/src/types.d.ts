/**
 * Contrato de tipos del dominio de Proveeduria (Modulo 1).
 *
 * FUENTE DE VERDAD: docs/specs/*. Este archivo es puro (sin efectos, sin IO).
 * Todo el resto del monorepo importa el vocabulario del dominio desde aqui.
 * No cambiar sin actualizar la spec correspondiente primero (AI_ASSISTED_DEVELOPMENT.md).
 *
 * Refs:
 *  - Estados/transiciones: docs/specs/state-machine.md
 *  - Entidades y enums:     docs/specs/data-model.md
 *  - Excepciones:           docs/specs/exceptions.md
 *  - Tools/roles:           docs/specs/tools.md
 */
export type Ok<T> = {
    ok: true;
    value: T;
};
export type Err<E> = {
    ok: false;
    error: E;
};
export type Result<T, E> = Ok<T> | Err<E>;
export declare const ok: <T>(value: T) => Ok<T>;
export declare const err: <E>(error: E) => Err<E>;
export declare const ROLES: readonly ["superadmin", "admin_materiales", "admin_equipos", "ingeniero", "bodeguero"];
export type Rol = (typeof ROLES)[number];
export declare const ESTADOS_PEDIDO: readonly ["borrador", "cotizando", "en_revision", "aprobado", "ordenado", "recepcion_parcial", "recepcion_total", "cerrado", "cancelado"];
export type EstadoPedido = (typeof ESTADOS_PEDIDO)[number];
/** Estados terminales: no admiten ninguna transicion de salida. */
export declare const ESTADOS_TERMINALES: readonly EstadoPedido[];
/** El sistema (cron/worker) dispara la transicion de forma automatica. */
export type ActorSistema = {
    tipo: 'sistema';
};
/** Un usuario con alguno de estos roles dispara la transicion. */
export type ActorRoles = {
    tipo: 'roles';
    roles: readonly Rol[];
};
export type ActorTransicion = ActorSistema | ActorRoles;
export declare const TIPOS_APROBACION: readonly ["lista_proveedores", "ganador", "emision_oc", "recepcion", "nc", "cierre"];
export type TipoAprobacion = (typeof TIPOS_APROBACION)[number];
export declare const CANALES_APROBACION: readonly ["whatsapp", "web"];
export type CanalAprobacion = (typeof CANALES_APROBACION)[number];
export declare const ESTADOS_QUOTE_REQUEST: readonly ["enviada", "respondida", "vencida", "declinada"];
export type EstadoQuoteRequest = (typeof ESTADOS_QUOTE_REQUEST)[number];
export declare const ESTADOS_QUOTE_RESPONSE: readonly ["completa", "incompleta", "descartada"];
export type EstadoQuoteResponse = (typeof ESTADOS_QUOTE_RESPONSE)[number];
export declare const FUENTES_EXTRACCION: readonly ["texto", "imagen", "pdf", "audio"];
export type FuenteExtraccion = (typeof FUENTES_EXTRACCION)[number];
export declare const ESTADOS_OC: readonly ["emitida", "confirmada", "recibida_parcial", "recibida_total", "anulada"];
export type EstadoOC = (typeof ESTADOS_OC)[number];
export declare const ESTADOS_FACTURA: readonly ["pendiente_revision", "conciliada", "disputada"];
export type EstadoFactura = (typeof ESTADOS_FACTURA)[number];
export declare const ESTADOS_NOTA_CREDITO: readonly ["pendiente_asociacion", "aplicada"];
export type EstadoNotaCredito = (typeof ESTADOS_NOTA_CREDITO)[number];
export declare const ESTADOS_RENTAL: readonly ["activo", "cerrado"];
export type EstadoRental = (typeof ESTADOS_RENTAL)[number];
export declare const TIPOS_MOVIMIENTO_EQUIPO: readonly ["entrada", "devolucion"];
export type TipoMovimientoEquipo = (typeof TIPOS_MOVIMIENTO_EQUIPO)[number];
export declare const ESTADOS_OUTBOX: readonly ["pendiente", "enviado", "fallido"];
export type EstadoOutbox = (typeof ESTADOS_OUTBOX)[number];
export declare const TIPOS_REVIEW_QUEUE: readonly ["factura_sin_oc", "diferencia_monto", "nc_ambigua", "cotizacion_incompleta", "extraccion_baja_confianza", "material_no_coincide"];
export type TipoReviewQueue = (typeof TIPOS_REVIEW_QUEUE)[number];
export declare const ESTADOS_REVIEW_QUEUE: readonly ["pendiente", "resuelta"];
export type EstadoReviewQueue = (typeof ESTADOS_REVIEW_QUEUE)[number];
export declare const ORIGENES_AUDIT: readonly ["wamid", "web", "cron", "system"];
export type OrigenAudit = (typeof ORIGENES_AUDIT)[number];
export declare const TIPOS_FEEDBACK: readonly ["error", "sugerencia"];
export type TipoFeedback = (typeof TIPOS_FEEDBACK)[number];
export declare const CODIGOS_EXCEPCION: readonly ["E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8", "E9", "E10", "E11", "E12", "E13"];
export type CodigoExcepcion = (typeof CODIGOS_EXCEPCION)[number];
export declare const PREFIJOS_NUMERACION: readonly ["PED", "OC"];
export type PrefijoNumeracion = (typeof PREFIJOS_NUMERACION)[number];
export interface UmbralesConfig {
    /** E2: confianza minima de extraccion de cotizacion para considerarla completa. */
    readonly confianzaMinCotizacion: number;
    /** E2: maximo de repreguntas a un proveedor antes de escalar. */
    readonly maxRepreguntasProveedor: number;
    /** E9: confianza minima de extraccion de factura en campos de monto/numero. */
    readonly confianzaMinFactura: number;
    /** E4: diferencia relativa maxima tolerada factura vs OC (fraccion, ej. 0.01 = 1%). */
    readonly difMontoRelMax: number;
    /** E4: piso absoluto de tolerancia de diferencia de monto en CRC. */
    readonly difMontoAbsMinCRC: number;
    /** E5: diferencia de cantidad recibida considerada "menor" (no bloquea). */
    readonly difCantidadMenor: number;
    /** RFQ: plazo por defecto para cotizar, en horas (tools.md enviar_rfq). */
    readonly plazoCotizacionHorasDefault: number;
    /** E13: horas en `en_revision` sin decision antes de recordatorio. */
    readonly horasAtascoEnRevision: number;
    /** E13: horas en `aprobado` sin OC confirmada por proveedor antes de recordatorio. */
    readonly horasAtascoAprobado: number;
}
//# sourceMappingURL=types.d.ts.map