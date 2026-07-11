/**
 * Engine de dominio conversacional Claude (docs/specs/agente-conversacional.md §A5 + §A6).
 *
 * Remitente INTERNO (§A5):
 *  1. Construye el historial (ConversacionRepo.historialPorTelefono) ANTES del mensaje actual.
 *  2. Arma el prompt de sistema (`construirPromptSistema`) con proyectos activos + actor.
 *  3. Corre `ejecutarTurnoConversacional` (loop model-backed; las tools validan todo).
 *  4. Encola la respuesta por outbox (sesion libre) y audita `agente_turno`.
 *
 * Remitente PROVEEDOR (§A6): NO corre el modelo conversacional. Ejecuta como ACTOR SISTEMA
 * (`crearCtxSistema`, origen `wamid`):
 *  (a) BAJA: texto normalizado === 'baja' -> `optin_at=null` + audit `contacto_baja` +
 *      notificacion interna a Proveeduria + confirmacion fija al proveedor. No pasa por extractor.
 *  (b) Resuelve la RFQ activa por remitente (`rfqsActivasPorContacto`): 1 -> esa; >1 ->
 *      repregunta el numero de pedido (o match directo si el texto trae PED-YYYY-NNN); 0 ->
 *      audit `proveedor_sin_rfq` + respuesta cortes.
 *  (c) Extrae segun tipo (texto / media con el attachment del pipeline) y llama
 *      `registrar_cotizacion` (Ctx sistema) — la tool maneja E2/repreguntas/review/transicion/
 *      comparativo. Confirmacion breve fija si `ok`; si la tool encolo repregunta E2 NO se
 *      duplica confirmacion.
 *
 * Gating (§A5/§A6): el engine se monta con `ANTHROPIC_API_KEY`. Sin `extractor` inyectado el
 * camino del proveedor cae al seam de audit (`agente_proveedor_pendiente`), como antes de A6.
 */

import {
  construirPromptSistema,
  crearCtxSistema,
  ejecutarTurnoConversacional,
  registrarCotizacion,
} from '@proveeduria/agent';
import type {
  Ctx,
  ExtractorCotizacion,
  ItemPedidoParaExtraccion,
  MaterialCotizacion,
  MensajeHistorial,
  ModeloConversacional,
  ProyectoPrompt,
  RfqActivaProveedor,
  Tx,
} from '@proveeduria/agent';
import type {
  AdjuntoInbound,
  DomainEngine,
  DomainEngineInput,
  SupplierContactContext,
} from './types.js';

export interface CrearClaudeDomainEngineDeps {
  readonly modelo: ModeloConversacional;
  /** Maximo de pasos por mensaje (default el de la spec: 5). */
  readonly maxPasos?: number;
  /**
   * Extractor de cotizaciones (A6). Presente -> el camino del proveedor extrae y llama
   * `registrar_cotizacion`. Ausente -> seam de audit (`agente_proveedor_pendiente`).
   */
  readonly extractor?: ExtractorCotizacion;
  /**
   * Fabrica del `Ctx` de sistema del proveedor (inyectable en tests). Default:
   * `crearCtxSistema` con origen `wamid` sobre la `tx` del handler.
   */
  readonly ctxProveedor?: (deps: { readonly tx: Tx; readonly ahora: Date }) => Ctx;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Extrae el texto del payload Meta (mismo criterio que `structured.ts`). */
function textoDePayload(payload: unknown): string {
  if (!isRecord(payload)) return '';
  if (typeof payload.text === 'string') return payload.text;
  if (isRecord(payload.text) && typeof payload.text.body === 'string') return payload.text.body;
  if (typeof payload.body === 'string') return payload.body;
  if (typeof payload.caption === 'string') return payload.caption;
  return '';
}

/** trim + minusculas + sin tildes (para el comando fijo `baja`). */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

/**
 * Separa el mensaje actual del historial (§A5). `historialPorTelefono` incluye el inbound recien
 * persistido (ultima fila `entrante`); esa fila ES el mensaje actual y se saca del historial.
 */
function separarMensajeActual(
  historialCompleto: readonly MensajeHistorial[],
  payload: unknown,
): { readonly historial: readonly MensajeHistorial[]; readonly mensajeUsuario: string } {
  const ultimo = historialCompleto[historialCompleto.length - 1];
  if (ultimo !== undefined && ultimo.direccion === 'entrante') {
    return { historial: historialCompleto.slice(0, -1), mensajeUsuario: ultimo.texto };
  }
  return { historial: historialCompleto, mensajeUsuario: textoDePayload(payload) };
}

export function crearClaudeDomainEngine(deps: CrearClaudeDomainEngineDeps): DomainEngine {
  const ctxProveedorFactory = deps.ctxProveedor
    ?? (({ tx, ahora }): Ctx => crearCtxSistema({ tx, ahora, origen: 'wamid' }));

  return {
    async procesar(input: DomainEngineInput): Promise<void> {
      const contexto = input.contexto;

      if (contexto.tipo === 'interno' && input.ctx !== undefined) {
        await procesarInterno(input, input.ctx, deps);
        return;
      }

      if (contexto.tipo === 'proveedor' && deps.extractor !== undefined) {
        const ctx = ctxProveedorFactory({ tx: input.tx, ahora: input.ahora });
        await procesarProveedor(input, contexto.supplierContact, ctx, deps.extractor);
        return;
      }

      // Sin `Ctx` interno / sin extractor: seam de A6 (audit claro, sin efecto de dominio).
      await auditarProveedorPendiente(input);
    },
  };
}

async function procesarInterno(
  input: DomainEngineInput,
  ctx: Ctx,
  deps: CrearClaudeDomainEngineDeps,
): Promise<void> {
  const contexto = input.contexto;
  if (contexto.tipo !== 'interno') return;
  const actor = contexto.actor;
  const phone = contexto.telefonoWhatsapp;

  const historialCompleto = await ctx.repos.conversaciones.historialPorTelefono(phone, 20);
  const { historial, mensajeUsuario } = separarMensajeActual(historialCompleto, input.mensaje.payload);

  const proyectosActivos = await ctx.repos.proyectos.listarActivos();
  const proyectosPrompt: readonly ProyectoPrompt[] = proyectosActivos.map((p) => ({
    id: p.id,
    nombre: p.nombre,
    codigo: p.codigo,
  }));

  const promptSistema = construirPromptSistema({
    nombreUsuario: actor.nombre,
    roles: actor.roles,
    proyectosActivos: proyectosPrompt,
    ahora: input.ahora,
  });

  const resultado = await ejecutarTurnoConversacional({
    modelo: deps.modelo,
    ctx,
    promptSistema,
    historial,
    mensajeUsuario,
    ...(deps.maxPasos !== undefined ? { maxPasos: deps.maxPasos } : {}),
  });

  if (resultado.respuesta !== null && resultado.respuesta.trim() !== '') {
    await ctx.outbox({ destino: phone, texto: resultado.respuesta });
  }

  await ctx.audit({
    accion: 'agente_turno',
    entidad: 'inbound_message',
    entidadId: input.mensaje.id,
    antes: null,
    despues: {
      tools_ejecutadas: resultado.toolsEjecutadas,
      respondido: resultado.respuesta !== null,
    },
  });
}

// ---------------------------------------------------------------------------
// Camino del proveedor (A6).
// ---------------------------------------------------------------------------

async function procesarProveedor(
  input: DomainEngineInput,
  sc: SupplierContactContext,
  ctx: Ctx,
  extractor: ExtractorCotizacion,
): Promise<void> {
  const texto = textoDePayload(input.mensaje.payload);

  // (a) BAJA — no pasa por el extractor.
  if (normalizar(texto) === 'baja') {
    await darDeBaja(input, sc, ctx);
    return;
  }

  // (b) Resolucion de la RFQ activa por remitente.
  const rfqs = await ctx.repos.quoteRequests.rfqsActivasPorContacto(sc.id);
  if (rfqs.length === 0) {
    await ctx.audit({
      accion: 'proveedor_sin_rfq',
      entidad: 'supplier_contact',
      entidadId: sc.id,
      antes: null,
      despues: { wamid: input.mensaje.wamid, supplier_id: sc.supplierId },
    });
    await ctx.outbox({
      destino: sc.telefonoWhatsapp,
      texto: 'Gracias por escribirnos. No tenemos ninguna cotización pendiente con ustedes en este momento.',
    });
    return;
  }

  const rfq = resolverRfq(rfqs, texto);
  if (rfq === null) {
    // >1 RFQ activa y el texto no trae un PED que matchee: repregunta el numero de pedido.
    const numeros = rfqs.map((r) => r.pedidoNumero).join(', ');
    await ctx.audit({
      accion: 'proveedor_rfq_ambigua',
      entidad: 'supplier_contact',
      entidadId: sc.id,
      antes: null,
      despues: { wamid: input.mensaje.wamid, pedidos: rfqs.map((r) => r.pedidoNumero) },
    });
    await ctx.outbox({
      destino: sc.telefonoWhatsapp,
      texto:
        `Tenemos varias solicitudes de cotización con ustedes (${numeros}). ¿Para cuál pedido es ` +
        `esta cotización? Indicanos el número (por ejemplo ${rfqs[0]?.pedidoNumero ?? 'PED-...'}).`,
    });
    return;
  }

  // (c) Material del extractor: adjunto descargado (A6, media.ts) o texto.
  const material = construirMaterial(input.adjunto, texto);
  if (material === null) {
    // Media que no se pudo descargar/procesar (sin adjunto): repregunta cortes, sin quote_response.
    await ctx.audit({
      accion: 'media_no_procesable',
      entidad: 'quote_request',
      entidadId: rfq.quoteRequestId,
      pedidoId: rfq.pedidoId,
      antes: null,
      despues: { wamid: input.mensaje.wamid, tipo: input.mensaje.tipo },
    });
    await ctx.outbox({
      destino: sc.telefonoWhatsapp,
      texto: `No pudimos procesar el archivo de la cotización para ${rfq.pedidoNumero}. ¿Nos lo reenviás por texto o foto?`,
    });
    return;
  }

  const itemsPedido = await itemsParaExtraccion(ctx, rfq.pedidoId);
  const resultado = await extractor.extraer({
    quoteRequestId: rfq.quoteRequestId,
    material,
    itemsPedido,
  });

  if (resultado.tipo === 'no_procesable') {
    // Audio sin OPENAI_API_KEY (o material ilegible): repregunta directa por outbox + audit,
    // SIN crear quote_response y SIN tocar el contador de repreguntas E2 (spec §A6).
    const esAudio = material.tipo === 'audio';
    await ctx.audit({
      accion: esAudio ? 'audio_no_procesable' : 'extraccion_no_procesable',
      entidad: 'quote_request',
      entidadId: rfq.quoteRequestId,
      pedidoId: rfq.pedidoId,
      antes: null,
      despues: { wamid: input.mensaje.wamid, motivo: resultado.motivo },
    });
    await ctx.outbox({
      destino: sc.telefonoWhatsapp,
      texto: esAudio
        ? `No pude procesar el audio de la cotización para ${rfq.pedidoNumero}. ¿Me lo enviás en texto o foto?`
        : `No pudimos leer la cotización para ${rfq.pedidoNumero}. ¿Nos la reenviás en texto o foto?`,
    });
    return;
  }

  // La tool valida todo (E2/repreguntas/review/transicion/comparativo) como actor sistema.
  const toolResult = await registrarCotizacion(resultado.input, ctx);

  await ctx.audit({
    accion: 'agente_proveedor_cotizacion',
    entidad: 'quote_request',
    entidadId: rfq.quoteRequestId,
    pedidoId: rfq.pedidoId,
    antes: null,
    despues: {
      wamid: input.mensaje.wamid,
      pedido: rfq.pedidoNumero,
      fuente: resultado.input.fuente,
      ok: toolResult.ok,
      ...(toolResult.ok ? {} : { error: toolResult.error }),
    },
  });

  if (toolResult.ok) {
    await ctx.outbox({
      destino: sc.telefonoWhatsapp,
      texto: `Recibimos su cotización para ${rfq.pedidoNumero}, ¡gracias!`,
    });
    return;
  }

  // E2: la tool ya encolo la repregunta (o escalo a Proveeduria); NO duplicar confirmacion.
  if (toolResult.error.codigo === 'E2') return;

  // Otros errores (p.ej. E12/no_encontrado): respuesta cortes sin filtrar detalle interno.
  await ctx.outbox({
    destino: sc.telefonoWhatsapp,
    texto: `Gracias, recibimos su mensaje sobre ${rfq.pedidoNumero}. Proveeduría lo va a revisar.`,
  });
}

async function darDeBaja(
  input: DomainEngineInput,
  sc: SupplierContactContext,
  ctx: Ctx,
): Promise<void> {
  await ctx.tx.query('UPDATE supplier_contacts SET optin_at = null WHERE id = $1', [sc.id]);
  await ctx.audit({
    accion: 'contacto_baja',
    entidad: 'supplier_contact',
    entidadId: sc.id,
    antes: null,
    despues: { wamid: input.mensaje.wamid, supplier_id: sc.supplierId },
  });
  await notificarProveeduria(
    ctx,
    `El contacto ${sc.nombre ?? sc.telefonoWhatsapp} se dio de baja de las solicitudes de cotización.`,
  );
  await ctx.outbox({
    destino: sc.telefonoWhatsapp,
    texto: 'Listo, te dimos de baja de las solicitudes de cotización. Escribinos cuando quieras volver a recibirlas.',
  });
}

/** Notificacion interna a admin_materiales (Proveeduria) sin pedido asociado (BAJA). */
async function notificarProveeduria(ctx: Ctx, resumen: string): Promise<void> {
  const admins = await ctx.repos.usuarios.activosPorRol('admin_materiales');
  for (const admin of admins) {
    await ctx.outbox({
      destino: admin.telefonoWhatsapp,
      template: 'notificacion_interna',
      payload: { variables: [admin.nombre, resumen] },
    });
  }
}

/**
 * Elige la RFQ objetivo: si el texto trae un PED-YYYY-NNN que matchea una RFQ activa, esa gana
 * (aunque haya varias); si no, con exactamente 1 RFQ es esa; con >1 sin match -> `null`
 * (el llamador repregunta el numero de pedido).
 */
function resolverRfq(
  rfqs: readonly RfqActivaProveedor[],
  texto: string,
): RfqActivaProveedor | null {
  const peds = new Set((texto.toUpperCase().match(/PED-\d{4}-\d+/g) ?? []));
  if (peds.size > 0) {
    const match = rfqs.find((r) => peds.has(r.pedidoNumero.toUpperCase()));
    if (match !== undefined) return match;
  }
  if (rfqs.length === 1) return rfqs[0] ?? null;
  return null;
}

/** Construye el material del extractor desde el adjunto (A6) o el texto; `null` si es media sin adjunto. */
function construirMaterial(
  adjunto: AdjuntoInbound | undefined,
  texto: string,
): MaterialCotizacion | null {
  if (adjunto !== undefined) {
    if (adjunto.fuente === 'imagen') {
      return { tipo: 'imagen', bytes: adjunto.bytes, mimeType: adjunto.contentType };
    }
    if (adjunto.fuente === 'pdf') {
      return { tipo: 'pdf', bytes: adjunto.bytes, mimeType: adjunto.contentType };
    }
    return { tipo: 'audio', bytes: adjunto.bytes, mimeType: adjunto.contentType };
  }
  if (texto.trim() !== '') {
    return { tipo: 'texto', texto };
  }
  // Sin adjunto y sin texto: probablemente media que no se pudo descargar -> null.
  return null;
}

async function itemsParaExtraccion(
  ctx: Ctx,
  pedidoId: string,
): Promise<readonly ItemPedidoParaExtraccion[]> {
  const items = await ctx.repos.pedidoItems.porPedido(pedidoId);
  return items.map((item) => ({
    pedidoItemId: item.id,
    descripcion: item.descripcion,
    cantidad: item.cantidad,
    unidad: item.unidad,
  }));
}

/**
 * Audit de seam para el camino del proveedor cuando NO hay extractor (gating A6). Sin `Ctx`
 * interno, se escribe directo en `audit_events` (actor sistema), igual patron que structured-engine.
 */
async function auditarProveedorPendiente(input: DomainEngineInput): Promise<void> {
  await input.tx.query(
    'INSERT INTO audit_events ' +
      '(actor_user_id, actor_sistema, accion, entidad, entidad_id, pedido_id, antes, despues, origen, at) ' +
      'VALUES (null, true, $1, $2, $3, null, null, $4::jsonb, $5, $6)',
    [
      'agente_proveedor_pendiente',
      'inbound_message',
      input.mensaje.id,
      JSON.stringify({ wamid: input.mensaje.wamid, remitente: input.contexto.tipo }),
      'wamid',
      input.ahora,
    ],
  );
}
