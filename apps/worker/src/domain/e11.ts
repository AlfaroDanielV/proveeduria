import type { Tx } from '@proveeduria/agent';
import type { InboundMessage, UnknownSenderReporter } from './types.js';

const TEXTO_DESCONOCIDO =
  'Hola. Soy el Asistente de Proveeduria de Proyekta. ' +
  'No tengo este numero registrado para gestionar pedidos o cotizaciones. ' +
  'Voy a avisarle al equipo interno para revisar el acceso.';

export class PgUnknownSenderReporter implements UnknownSenderReporter {
  async reportar(input: {
    readonly tx: Tx;
    readonly mensaje: InboundMessage;
    readonly contexto: { readonly tipo: 'desconocido'; readonly telefonoWhatsapp: string };
    readonly ahora: Date;
  }): Promise<void> {
    await input.tx.query(
      'INSERT INTO outbox_messages (destino, texto, payload) VALUES ($1, $2, $3::jsonb)',
      [
        input.contexto.telefonoWhatsapp || input.mensaje.fromPhone,
        TEXTO_DESCONOCIDO,
        JSON.stringify({
          codigo: 'E11',
          wamid: input.mensaje.wamid,
          from_phone: input.mensaje.fromPhone,
        }),
      ],
    );
    await input.tx.query(
      'INSERT INTO audit_events ' +
        '(actor_sistema, accion, entidad, entidad_id, pedido_id, antes, despues, origen, at) ' +
        'VALUES (true, $1, $2, $3, null, null, $4::jsonb, $5, $6)',
      [
        'remitente_desconocido',
        'inbound_message',
        input.mensaje.id,
        JSON.stringify({
          codigo: 'E11',
          wamid: input.mensaje.wamid,
          from_phone: input.mensaje.fromPhone,
        }),
        'wamid',
        input.ahora,
      ],
    );
  }
}
