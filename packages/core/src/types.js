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
export const ok = (value) => ({ ok: true, value });
export const err = (error) => ({ ok: false, error });
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
];
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
];
/** Estados terminales: no admiten ninguna transicion de salida. */
export const ESTADOS_TERMINALES = ['cerrado', 'cancelado'];
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
];
export const CANALES_APROBACION = ['whatsapp', 'web'];
// ---------------------------------------------------------------------------
// Estados por entidad (data-model.md)
// ---------------------------------------------------------------------------
export const ESTADOS_QUOTE_REQUEST = ['enviada', 'respondida', 'vencida', 'declinada'];
export const ESTADOS_QUOTE_RESPONSE = ['completa', 'incompleta', 'descartada'];
export const FUENTES_EXTRACCION = ['texto', 'imagen', 'pdf', 'audio'];
export const ESTADOS_OC = [
    'emitida',
    'confirmada',
    'recibida_parcial',
    'recibida_total',
    'anulada',
];
export const ESTADOS_FACTURA = ['pendiente_revision', 'conciliada', 'disputada'];
export const ESTADOS_NOTA_CREDITO = ['pendiente_asociacion', 'aplicada'];
export const ESTADOS_RENTAL = ['activo', 'cerrado'];
export const TIPOS_MOVIMIENTO_EQUIPO = ['entrada', 'devolucion'];
// ---------------------------------------------------------------------------
// Mensajeria y operacion (data-model.md §Mensajeria y operacion)
// ---------------------------------------------------------------------------
export const ESTADOS_OUTBOX = ['pendiente', 'enviado', 'fallido'];
export const TIPOS_REVIEW_QUEUE = [
    'factura_sin_oc',
    'diferencia_monto',
    'nc_ambigua',
    'cotizacion_incompleta',
    'extraccion_baja_confianza',
    'material_no_coincide',
];
export const ESTADOS_REVIEW_QUEUE = ['pendiente', 'resuelta'];
export const ORIGENES_AUDIT = ['wamid', 'web', 'cron', 'system'];
export const TIPOS_FEEDBACK = ['error', 'sugerencia'];
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
];
// ---------------------------------------------------------------------------
// Numeracion correlativa (data-model.md regla dura 4; PED-YYYY-NNN / OC-YYYY-NNN)
// ---------------------------------------------------------------------------
export const PREFIJOS_NUMERACION = ['PED', 'OC'];
//# sourceMappingURL=types.js.map