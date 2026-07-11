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

// ---------------------------------------------------------------------------
// Result: retorno de validaciones puras del core (nunca lanza para flujo normal)
// ---------------------------------------------------------------------------

export type Ok<T> = { ok: true; value: T };
export type Err<E> = { ok: false; error: E };
export type Result<T, E> = Ok<T> | Err<E>;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = <E>(error: E): Err<E> => ({ ok: false, error });

// ---------------------------------------------------------------------------
// Roles (data-model.md §Identidad y acceso; PDF §3.1). Catalogo fijo de 5.
// "Proveeduria" del PDF == admin_materiales. "Gerencia" (lectura amplia) == superadmin.
// (Ver docs/specs/tools.md; reconciliacion documentada en packages/core/CLAUDE.md.)
// ---------------------------------------------------------------------------

export const ROLES = [
  'superadmin',
  'admin_materiales',
  'admin_equipos',
  'ingeniero',
  'bodeguero',
] as const;
export type Rol = (typeof ROLES)[number];

// ---------------------------------------------------------------------------
// Estados del pedido (state-machine.md)
// ---------------------------------------------------------------------------

export const ESTADOS_PEDIDO = [
  'borrador',
  'cotizando',
  'en_revision',
  'aprobado',
  'ordenado',
  'recepcion_parcial',
  'recepcion_total',
  'cerrado',
  'cancelado',
] as const;
export type EstadoPedido = (typeof ESTADOS_PEDIDO)[number];

/** Estados terminales: no admiten ninguna transicion de salida. */
export const ESTADOS_TERMINALES: readonly EstadoPedido[] = ['cerrado', 'cancelado'];

// ---------------------------------------------------------------------------
// Actor de una transicion / accion (state-machine.md columna "Quien lo activa")
// ---------------------------------------------------------------------------

/** El sistema (cron/worker) dispara la transicion de forma automatica. */
export type ActorSistema = { tipo: 'sistema' };
/** Un usuario con alguno de estos roles dispara la transicion. */
export type ActorRoles = { tipo: 'roles'; roles: readonly Rol[] };
export type ActorTransicion = ActorSistema | ActorRoles;

// ---------------------------------------------------------------------------
// Aprobaciones humanas obligatorias (approval_events; EXECUTION_PLAN §1.5)
// ---------------------------------------------------------------------------

export const TIPOS_APROBACION = [
  'lista_proveedores',
  'ganador',
  'emision_oc',
  'recepcion',
  'nc',
  'cierre',
] as const;
export type TipoAprobacion = (typeof TIPOS_APROBACION)[number];

export const CANALES_APROBACION = ['whatsapp', 'web'] as const;
export type CanalAprobacion = (typeof CANALES_APROBACION)[number];

// ---------------------------------------------------------------------------
// Estados por entidad (data-model.md)
// ---------------------------------------------------------------------------

export const ESTADOS_QUOTE_REQUEST = ['enviada', 'respondida', 'vencida', 'declinada'] as const;
export type EstadoQuoteRequest = (typeof ESTADOS_QUOTE_REQUEST)[number];

export const ESTADOS_QUOTE_RESPONSE = ['completa', 'incompleta', 'descartada'] as const;
export type EstadoQuoteResponse = (typeof ESTADOS_QUOTE_RESPONSE)[number];

export const FUENTES_EXTRACCION = ['texto', 'imagen', 'pdf', 'audio'] as const;
export type FuenteExtraccion = (typeof FUENTES_EXTRACCION)[number];

export const ESTADOS_OC = [
  'emitida',
  'confirmada',
  'recibida_parcial',
  'recibida_total',
  'anulada',
] as const;
export type EstadoOC = (typeof ESTADOS_OC)[number];

export const ESTADOS_FACTURA = ['pendiente_revision', 'conciliada', 'disputada'] as const;
export type EstadoFactura = (typeof ESTADOS_FACTURA)[number];

export const ESTADOS_NOTA_CREDITO = ['pendiente_asociacion', 'aplicada'] as const;
export type EstadoNotaCredito = (typeof ESTADOS_NOTA_CREDITO)[number];

export const ESTADOS_RENTAL = ['activo', 'cerrado'] as const;
export type EstadoRental = (typeof ESTADOS_RENTAL)[number];

export const TIPOS_MOVIMIENTO_EQUIPO = ['entrada', 'devolucion'] as const;
export type TipoMovimientoEquipo = (typeof TIPOS_MOVIMIENTO_EQUIPO)[number];

// ---------------------------------------------------------------------------
// Mensajeria y operacion (data-model.md §Mensajeria y operacion)
// ---------------------------------------------------------------------------

export const ESTADOS_OUTBOX = ['pendiente', 'enviado', 'fallido'] as const;
export type EstadoOutbox = (typeof ESTADOS_OUTBOX)[number];

export const TIPOS_REVIEW_QUEUE = [
  'factura_sin_oc',
  'diferencia_monto',
  'nc_ambigua',
  'cotizacion_incompleta',
  'extraccion_baja_confianza',
  'material_no_coincide',
] as const;
export type TipoReviewQueue = (typeof TIPOS_REVIEW_QUEUE)[number];

export const ESTADOS_REVIEW_QUEUE = ['pendiente', 'resuelta'] as const;
export type EstadoReviewQueue = (typeof ESTADOS_REVIEW_QUEUE)[number];

export const ORIGENES_AUDIT = ['wamid', 'web', 'cron', 'system'] as const;
export type OrigenAudit = (typeof ORIGENES_AUDIT)[number];

export const TIPOS_FEEDBACK = ['error', 'sugerencia'] as const;
export type TipoFeedback = (typeof TIPOS_FEEDBACK)[number];

// ---------------------------------------------------------------------------
// Codigos de excepcion (exceptions.md tabla normativa E1..E13)
// ---------------------------------------------------------------------------

export const CODIGOS_EXCEPCION = [
  'E1', // Proveedor no responde cotizacion en plazo
  'E2', // Cotizacion incompleta o ambigua
  'E3', // Factura no coincide con ninguna OC abierta
  'E4', // Factura con diferencia significativa de monto vs OC
  'E5', // Material recibido != ordenado
  'E6', // Nota de credito sin factura identificable
  'E7', // Pedido sin proyecto identificable
  'E8', // Mensaje fuera del alcance de proveeduria
  'E9', // Extraccion OCR de factura bajo umbral
  'E10', // Devolucion de equipo mayor que inventario activo
  'E11', // Remitente desconocido
  'E12', // Transicion de estado invalida solicitada
  'E13', // Pedido atascado
] as const;
export type CodigoExcepcion = (typeof CODIGOS_EXCEPCION)[number];

// ---------------------------------------------------------------------------
// Numeracion correlativa (data-model.md regla dura 4; PED-YYYY-NNN / OC-YYYY-NNN)
// ---------------------------------------------------------------------------

export const PREFIJOS_NUMERACION = ['PED', 'OC'] as const;
export type PrefijoNumeracion = (typeof PREFIJOS_NUMERACION)[number];

// ---------------------------------------------------------------------------
// Umbrales configurables (exceptions.md §3: viven en tabla `config`,
// editable por superadmin; valores iniciales = los de la spec).
// Las reglas del core reciben estos umbrales como parametro (funciones puras).
// ---------------------------------------------------------------------------

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
  /**
   * E3: similitud minima (score de `matchFacturaOc`, 0..1) para aceptar una OC como match
   * unico de una factura. Bajo el umbral (o empate entre candidatas) escala a
   * `review_queue(factura_sin_oc)`. Default 0.6 (exceptions.md fila E3 y regla general 3).
   */
  readonly similitudMinFacturaOc: number;
}

// ---------------------------------------------------------------------------
// Extraccion de factura (exceptions.md fila E9): confianza por campo.
// ---------------------------------------------------------------------------

/** Un campo extraido con su valor (o `null` si no se pudo extraer) y la confianza del OCR/LLM. */
export interface CampoExtraido<T> {
  readonly valor: T | null;
  readonly confianza: number;
}

/**
 * Campos de factura con confianza por campo (exceptions.md fila E9: "El extractor entrega
 * confianza por campo: numero de factura, monto total, fecha, proveedor, y por linea").
 * Los campos por linea no se modelan aqui (viven en `invoice_items`, fuera de este contrato).
 */
export interface CamposFacturaExtraida {
  readonly numeroFactura: CampoExtraido<string>;
  readonly montoTotal: CampoExtraido<number>;
  readonly fecha: CampoExtraido<string>;
  readonly proveedorNombre: CampoExtraido<string>;
}
