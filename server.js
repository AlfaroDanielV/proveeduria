const http = require('http');
const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');

const PORT = process.env.PORT || 8080;

// ============================================================
// CLIENTS
// ============================================================

const anthropic = new Anthropic.default({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ============================================================
// SYSTEM PROMPT
// ============================================================

const SYSTEM_PROMPT = `Sos un asistente de proveeduría para una empresa constructora en Costa Rica.
Tu trabajo es registrar compras de materiales, consultar inventario, registrar facturas y generar reportes.

REGLAS:
- Hablás en español costarricense (vos, mae, tuanis) pero mantenés profesionalismo.
- Siempre confirmás los datos ANTES de llamar una tool de registro. Mostrá al usuario lo que vas a registrar y pedí confirmación.
- Si no entendés algo, pedí aclaración.
- Sos conciso — esto es WhatsApp, no escribas párrafos.
- Usás emojis con moderación.
- Cuando el usuario confirma, usá la tool correspondiente.
- Si el usuario manda una foto de factura, usá registrar_factura_escaneada para procesarla.
- Montos siempre en colones (₡) a menos que el usuario diga otra moneda.
- Para registrar un movimiento SIEMPRE necesitás: proyecto, material, cantidad, unidad. Precio y proveedor son opcionales pero intentá obtenerlos.
- Si el usuario no especifica el proyecto, preguntale o mostrá la lista de proyectos activos.

TONO Y ACCOUNTABILITY:
- Sos amigable pero no permisivo. Si detectás patrones de irresponsabilidad (compras sin factura repetidas, registros incompletos a propósito, datos que no cuadran, o incumplimiento de procesos), subís el tono.
- Primera vez: recordatorio amable. "Mae, acordate que necesito la factura para registrar esto bien."
- Reincidencia: directo y firme. "Vea, es la tercera compra esta semana sin factura. Eso complica todo el control del proyecto. Necesito que me mandés las fotos."
- Nunca insultás ni faltás al respeto, pero no te da miedo señalar el problema claramente.
- Si un monto o cantidad parece fuera de lo normal para el material (ej: 500 bolsas de cemento para una remodelación), cuestionalo antes de registrar: "¿Estás seguro? 500 bolsas parece bastante para este proyecto."
- Tu trabajo no es solo registrar — es cuidar los números del negocio. Si algo huele raro, lo decís.

FLUJO DE FACTURA:
1. Usuario manda foto → vos extraés los datos con registrar_factura_escaneada
2. Mostrás los datos extraídos y pedís confirmación
3. Usuario confirma → usás confirmar_factura para registrar los movimientos

FORMATO DE RESPUESTA:
- Usá formato simple, sin markdown pesado (WhatsApp no lo renderiza bien).
- Listas con guiones simples o números.
- Montos con separador de miles: ₡1.500, ₡25.000
- Fechas en formato DD/MM/AAAA o "hoy", "ayer".
- Por favor y gracias siempre que sea posible.`;

// ============================================================
// TOOL DEFINITIONS
// ============================================================
// Principio arquitectónico: agregar una tool = definir schema + handler.
// Claude descubre tools nuevas automáticamente.

const TOOLS = [
  {
    name: 'registrar_movimiento',
    description: 'Registra una compra o uso de material en un proyecto. Usala cuando el usuario confirme los datos de una compra.',
    input_schema: {
      type: 'object',
      properties: {
        proyecto_id: {
          type: 'string',
          description: 'UUID del proyecto. Si no lo tenés, usá listar_proyectos primero.',
        },
        material: {
          type: 'string',
          description: 'Nombre del material comprado (ej: "cemento", "varilla #3", "bloques 12x20")',
        },
        cantidad: {
          type: 'number',
          description: 'Cantidad comprada',
        },
        unidad: {
          type: 'string',
          description: 'Unidad de medida (ej: "bolsas", "metros", "unidades", "kg", "galones", "quintales")',
        },
        precio_unitario: {
          type: 'number',
          description: 'Precio por unidad en colones. Opcional.',
        },
        precio_total: {
          type: 'number',
          description: 'Precio total en colones. Opcional. Si no se da, se calcula como cantidad * precio_unitario.',
        },
        proveedor: {
          type: 'string',
          description: 'Nombre del proveedor (ej: "El Lagar", "Construplaza"). Opcional.',
        },
        notas: {
          type: 'string',
          description: 'Notas adicionales. Opcional.',
        },
        fecha_compra: {
          type: 'string',
          description: 'Fecha de la compra en formato YYYY-MM-DD. Si no se especifica, se usa hoy.',
        },
      },
      required: ['proyecto_id', 'material', 'cantidad', 'unidad'],
    },
  },
  {
    name: 'consultar_inventario',
    description: 'Consulta los materiales registrados para un proyecto específico o todos los proyectos. Usala cuando el usuario pregunte qué se ha comprado, cuánto se ha gastado, etc.',
    input_schema: {
      type: 'object',
      properties: {
        proyecto_id: {
          type: 'string',
          description: 'UUID del proyecto. Opcional — si no se da, muestra todos.',
        },
        material: {
          type: 'string',
          description: 'Filtrar por nombre de material (búsqueda parcial). Opcional.',
        },
        desde: {
          type: 'string',
          description: 'Fecha inicio para filtrar (YYYY-MM-DD). Opcional.',
        },
        hasta: {
          type: 'string',
          description: 'Fecha fin para filtrar (YYYY-MM-DD). Opcional.',
        },
      },
      required: [],
    },
  },
  {
    name: 'registrar_factura_escaneada',
    description: 'Procesa una foto de factura que el usuario envió por WhatsApp. Extrae los datos de la imagen y los guarda como factura pendiente de confirmación. Llamala cuando recibás una imagen de factura.',
    input_schema: {
      type: 'object',
      properties: {
        imagen_url: {
          type: 'string',
          description: 'URL de la imagen de la factura (ya almacenada en Supabase Storage).',
        },
        imagen_path: {
          type: 'string',
          description: 'Path interno de la imagen en el bucket de Supabase.',
        },
        datos_extraidos: {
          type: 'object',
          description: 'Datos extraídos de la factura por Claude Vision.',
          properties: {
            proveedor: { type: 'string' },
            fecha: { type: 'string' },
            total: { type: 'number' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  material: { type: 'string' },
                  cantidad: { type: 'number' },
                  unidad: { type: 'string' },
                  precio_unitario: { type: 'number' },
                  precio_total: { type: 'number' },
                },
              },
            },
          },
        },
        proyecto_id: {
          type: 'string',
          description: 'UUID del proyecto asociado. Puede ser null si no se sabe.',
        },
      },
      required: ['imagen_url', 'imagen_path', 'datos_extraidos'],
    },
  },
  {
    name: 'confirmar_factura',
    description: 'Confirma una factura pendiente y registra los movimientos asociados. Usala después de que el usuario revise y confirme los datos extraídos.',
    input_schema: {
      type: 'object',
      properties: {
        factura_id: {
          type: 'string',
          description: 'UUID de la factura a confirmar.',
        },
        proyecto_id: {
          type: 'string',
          description: 'UUID del proyecto al que asignar los movimientos.',
        },
        correcciones: {
          type: 'object',
          description: 'Correcciones a los datos extraídos (opcional). Misma estructura que datos_extraidos.',
        },
      },
      required: ['factura_id', 'proyecto_id'],
    },
  },
  {
    name: 'listar_proyectos',
    description: 'Lista los proyectos activos. Usala cuando necesités saber los proyectos disponibles para asignar compras.',
    input_schema: {
      type: 'object',
      properties: {
        incluir_completados: {
          type: 'boolean',
          description: 'Si true, incluye proyectos completados. Default: false.',
        },
      },
      required: [],
    },
  },
  {
    name: 'corregir_movimiento',
    description: 'Corrige un movimiento ya registrado. Usala cuando el usuario diga que se equivocó en un registro.',
    input_schema: {
      type: 'object',
      properties: {
        movimiento_id: {
          type: 'string',
          description: 'UUID del movimiento a corregir.',
        },
        campos: {
          type: 'object',
          description: 'Campos a actualizar. Solo incluí los que cambian.',
          properties: {
            material: { type: 'string' },
            cantidad: { type: 'number' },
            unidad: { type: 'string' },
            precio_unitario: { type: 'number' },
            precio_total: { type: 'number' },
            proveedor: { type: 'string' },
            notas: { type: 'string' },
            fecha_compra: { type: 'string' },
            proyecto_id: { type: 'string' },
          },
        },
      },
      required: ['movimiento_id', 'campos'],
    },
  },
];

// ============================================================
// TOOL HANDLERS
// ============================================================

async function handleTool(toolName, input, phoneNumber) {
  // Buscar usuario por teléfono
  const { data: usuario } = await supabase
    .from('usuarios')
    .select('id, nombre, rol')
    .eq('telefono', phoneNumber)
    .single();

  const userId = usuario?.id || null;

  switch (toolName) {
    case 'registrar_movimiento': {
      const precioTotal =
        input.precio_total ||
        (input.precio_unitario && input.cantidad
          ? input.precio_unitario * input.cantidad
          : null);

      const { data, error } = await supabase
        .from('movimientos')
        .insert({
          proyecto_id: input.proyecto_id,
          material: input.material,
          cantidad: input.cantidad,
          unidad: input.unidad,
          precio_unitario: input.precio_unitario || null,
          precio_total: precioTotal,
          proveedor: input.proveedor || null,
          notas: input.notas || null,
          fecha_compra: input.fecha_compra || new Date().toISOString().split('T')[0],
          registrado_por: userId,
          registrado_telefono: phoneNumber,
          factura_id: input.factura_id || null,
        })
        .select()
        .single();

      if (error) throw new Error(`Error registrando movimiento: ${error.message}`);

      // Obtener nombre del proyecto para la respuesta
      const { data: proyecto } = await supabase
        .from('proyectos')
        .select('nombre')
        .eq('id', input.proyecto_id)
        .single();

      return JSON.stringify({
        success: true,
        movimiento_id: data.id,
        proyecto: proyecto?.nombre || input.proyecto_id,
        material: data.material,
        cantidad: data.cantidad,
        unidad: data.unidad,
        precio_total: data.precio_total,
        proveedor: data.proveedor,
        fecha: data.fecha_compra,
      });
    }

    case 'consultar_inventario': {
      let query = supabase
        .from('movimientos')
        .select(`
          id, material, cantidad, unidad, precio_unitario, precio_total,
          proveedor, fecha_compra, notas,
          proyectos(nombre),
          usuarios(nombre)
        `)
        .order('fecha_compra', { ascending: false })
        .limit(20);

      if (input.proyecto_id) query = query.eq('proyecto_id', input.proyecto_id);
      if (input.material) query = query.ilike('material', `%${input.material}%`);
      if (input.desde) query = query.gte('fecha_compra', input.desde);
      if (input.hasta) query = query.lte('fecha_compra', input.hasta);

      const { data, error } = await query;
      if (error) throw new Error(`Error consultando inventario: ${error.message}`);

      // Calcular totales
      const totalGastado = data.reduce((sum, m) => sum + (m.precio_total || 0), 0);

      return JSON.stringify({
        total_registros: data.length,
        total_gastado: totalGastado,
        movimientos: data.map((m) => ({
          id: m.id,
          proyecto: m.proyectos?.nombre,
          material: m.material,
          cantidad: m.cantidad,
          unidad: m.unidad,
          precio_total: m.precio_total,
          proveedor: m.proveedor,
          fecha: m.fecha_compra,
          registrado_por: m.usuarios?.nombre,
        })),
      });
    }

    case 'registrar_factura_escaneada': {
      const { data, error } = await supabase
        .from('facturas')
        .insert({
          imagen_url: input.imagen_url,
          imagen_path: input.imagen_path,
          datos_extraidos: input.datos_extraidos,
          estado: 'pendiente',
          proveedor_detectado: input.datos_extraidos?.proveedor || null,
          total_detectado: input.datos_extraidos?.total || null,
          fecha_factura: input.datos_extraidos?.fecha || null,
          proyecto_id: input.proyecto_id || null,
          registrado_por: userId,
          registrado_telefono: phoneNumber,
        })
        .select()
        .single();

      if (error) throw new Error(`Error registrando factura: ${error.message}`);

      return JSON.stringify({
        success: true,
        factura_id: data.id,
        estado: 'pendiente',
        datos_extraidos: input.datos_extraidos,
        mensaje: 'Factura registrada. Necesita confirmación del usuario.',
      });
    }

    case 'confirmar_factura': {
      // 1. Obtener factura
      const { data: factura, error: fetchErr } = await supabase
        .from('facturas')
        .select('*')
        .eq('id', input.factura_id)
        .single();

      if (fetchErr || !factura) throw new Error('Factura no encontrada.');

      // Usar correcciones si las hay, sino datos originales
      const datos = input.correcciones || factura.datos_extraidos;
      const items = datos?.items || [];

      // 2. Registrar cada item como movimiento
      const movimientos = [];
      for (const item of items) {
        const precioTotal =
          item.precio_total || (item.precio_unitario && item.cantidad ? item.precio_unitario * item.cantidad : null);

        const { data: mov, error: movErr } = await supabase
          .from('movimientos')
          .insert({
            proyecto_id: input.proyecto_id,
            material: item.material,
            cantidad: item.cantidad || 1,
            unidad: item.unidad || 'unidades',
            precio_unitario: item.precio_unitario || null,
            precio_total: precioTotal,
            proveedor: datos.proveedor || factura.proveedor_detectado || null,
            factura_id: input.factura_id,
            fecha_compra: datos.fecha || factura.fecha_factura || new Date().toISOString().split('T')[0],
            registrado_por: userId,
            registrado_telefono: phoneNumber,
          })
          .select()
          .single();

        if (movErr) console.error('Error registrando item de factura:', movErr);
        else movimientos.push(mov);
      }

      // 3. Actualizar estado de factura
      await supabase
        .from('facturas')
        .update({
          estado: 'confirmada',
          confirmada_por: userId,
          proyecto_id: input.proyecto_id,
          datos_extraidos: datos,
        })
        .eq('id', input.factura_id);

      // Obtener nombre del proyecto
      const { data: proyecto } = await supabase
        .from('proyectos')
        .select('nombre')
        .eq('id', input.proyecto_id)
        .single();

      return JSON.stringify({
        success: true,
        factura_id: input.factura_id,
        estado: 'confirmada',
        proyecto: proyecto?.nombre,
        movimientos_registrados: movimientos.length,
        items: movimientos.map((m) => ({
          material: m.material,
          cantidad: m.cantidad,
          precio_total: m.precio_total,
        })),
      });
    }

    case 'listar_proyectos': {
      let query = supabase
        .from('resumen_gastos_proyecto')
        .select('*');

      // Si no quiere completados, la vista ya filtra por activo
      // Si quiere completados, hacemos query directo a proyectos
      if (input.incluir_completados) {
        const { data, error } = await supabase
          .from('proyectos')
          .select('id, nombre, direccion, estado, presupuesto')
          .order('estado');
        if (error) throw new Error(`Error listando proyectos: ${error.message}`);
        return JSON.stringify({ proyectos: data });
      }

      const { data, error } = await query;
      if (error) throw new Error(`Error listando proyectos: ${error.message}`);

      return JSON.stringify({
        proyectos: data.map((p) => ({
          id: p.proyecto_id,
          nombre: p.proyecto,
          presupuesto: p.presupuesto,
          total_gastado: p.total_gastado,
          presupuesto_restante: p.presupuesto_restante,
          total_movimientos: p.total_movimientos,
          ultima_compra: p.ultima_compra,
        })),
      });
    }

    case 'corregir_movimiento': {
      const { data, error } = await supabase
        .from('movimientos')
        .update(input.campos)
        .eq('id', input.movimiento_id)
        .select()
        .single();

      if (error) throw new Error(`Error corrigiendo movimiento: ${error.message}`);

      return JSON.stringify({
        success: true,
        movimiento_id: data.id,
        campos_actualizados: Object.keys(input.campos),
        valores_nuevos: input.campos,
      });
    }

    default:
      return JSON.stringify({ error: `Tool desconocida: ${toolName}` });
  }
}

// ============================================================
// CONVERSATION MANAGEMENT
// ============================================================

const conversations = new Map();

function getConversation(phoneNumber) {
  if (!conversations.has(phoneNumber)) {
    conversations.set(phoneNumber, []);
  }
  return conversations.get(phoneNumber);
}

function trimConversation(messages) {
  if (messages.length > 20) {
    return messages.slice(-20);
  }
  return messages;
}

// ============================================================
// CLAUDE AGENTIC LOOP
// ============================================================
// Claude puede llamar múltiples tools en secuencia.
// El loop continúa hasta que Claude responde con texto puro (end_turn).

async function askClaude(phoneNumber, userMessage) {
  const messages = getConversation(phoneNumber);

  // Si userMessage es un array (contiene imagen), úsalo directo
  if (Array.isArray(userMessage)) {
    messages.push({ role: 'user', content: userMessage });
  } else {
    messages.push({ role: 'user', content: userMessage });
  }

  const trimmed = trimConversation(messages);
  conversations.set(phoneNumber, trimmed);

  const MAX_LOOPS = 10; // safety limit
  let loops = 0;

  while (loops < MAX_LOOPS) {
    loops++;

    try {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages: trimmed,
      });

      // Process response content blocks
      const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use');
      const textBlocks = response.content.filter((b) => b.type === 'text');

      if (response.stop_reason === 'end_turn' || toolUseBlocks.length === 0) {
        // Claude is done — extract final text
        const finalText = textBlocks.map((b) => b.text).join('\n') || 'Listo ✅';
        trimmed.push({ role: 'assistant', content: response.content });
        return finalText;
      }

      // Claude wants to use tools — process them
      trimmed.push({ role: 'assistant', content: response.content });

      const toolResults = [];
      for (const toolBlock of toolUseBlocks) {
        console.log(`Tool call: ${toolBlock.name}`, JSON.stringify(toolBlock.input).substring(0, 200));

        try {
          const result = await handleTool(toolBlock.name, toolBlock.input, phoneNumber);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolBlock.id,
            content: result,
          });
        } catch (err) {
          console.error(`Tool error (${toolBlock.name}):`, err.message);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolBlock.id,
            content: JSON.stringify({ error: err.message }),
            is_error: true,
          });
        }
      }

      trimmed.push({ role: 'user', content: toolResults });

      // Loop continues — Claude will process tool results
    } catch (err) {
      console.error('Claude API error:', err);
      return 'Mae, tuve un problema procesando tu mensaje. Intentá de nuevo en un momento. 🔧';
    }
  }

  return 'Se me complicó un poco con esta solicitud. ¿Podés intentar de nuevo con menos info? 🤔';
}

// ============================================================
// WHATSAPP IMAGE HANDLING
// ============================================================

async function downloadWhatsAppMedia(mediaId) {
  const accessToken = process.env.META_ACCESS_TOKEN;

  // Step 1: Get media URL from Meta
  const mediaRes = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const mediaData = await mediaRes.json();

  if (!mediaData.url) {
    throw new Error('Could not get media URL from Meta');
  }

  // Step 2: Download the actual image
  const imageRes = await fetch(mediaData.url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!imageRes.ok) {
    throw new Error(`Failed to download image: ${imageRes.status}`);
  }

  const buffer = Buffer.from(await imageRes.arrayBuffer());
  const mimeType = mediaData.mime_type || 'image/jpeg';

  return { buffer, mimeType };
}

async function uploadToSupabase(buffer, mimeType) {
  const ext = mimeType.includes('png') ? 'png' : 'jpeg';
  const fileName = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
  const filePath = `incoming/${fileName}`;

  const { data, error } = await supabase.storage
    .from('facturas')
    .upload(filePath, buffer, {
      contentType: mimeType,
      upsert: false,
    });

  if (error) throw new Error(`Supabase Storage error: ${error.message}`);

  // Generate a signed URL (valid 1 year — for Claude Vision and reference)
  const { data: urlData } = await supabase.storage
    .from('facturas')
    .createSignedUrl(filePath, 60 * 60 * 24 * 365);

  return {
    path: filePath,
    url: urlData?.signedUrl || null,
  };
}

async function processInvoiceImage(phoneNumber, mediaId, caption) {
  try {
    // 1. Download from WhatsApp
    const { buffer, mimeType } = await downloadWhatsAppMedia(mediaId);

    // 2. Upload to Supabase Storage
    const { path, url } = await uploadToSupabase(buffer, mimeType);

    // 3. Convert image to base64 for Claude Vision
    const base64Image = buffer.toString('base64');

    // 4. Build message with image for Claude
    const userContent = [
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: mimeType,
          data: base64Image,
        },
      },
      {
        type: 'text',
        text: `El usuario envió esta foto de una factura.${caption ? ` Mensaje del usuario: "${caption}"` : ''}

INSTRUCCIONES:
1. Analizá la imagen y extraé: proveedor, fecha, items (material, cantidad, unidad, precio unitario, precio total), y total general.
2. Llamá la tool registrar_factura_escaneada con los datos extraídos.
   - imagen_url: "${url}"
   - imagen_path: "${path}"
3. Después de registrar, mostrá los datos al usuario y pedí confirmación.
4. Si no podés leer algo claramente, indicalo.`,
      },
    ];

    // 5. Send to Claude agentic loop
    const reply = await askClaude(phoneNumber, userContent);
    return reply;
  } catch (err) {
    console.error('Error processing invoice image:', err);
    return 'Mae, no pude procesar esa imagen. ¿Podés mandarla de nuevo? Intentá que la foto esté bien iluminada y enfocada 📸';
  }
}

// ============================================================
// SEND WHATSAPP MESSAGE
// ============================================================

async function sendWhatsAppMessage(to, text) {
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID;
  const accessToken = process.env.META_ACCESS_TOKEN;

  const chunks = [];
  if (text.length <= 4096) {
    chunks.push(text);
  } else {
    for (let i = 0; i < text.length; i += 4096) {
      chunks.push(text.slice(i, i + 4096));
    }
  }

  for (const chunk of chunks) {
    try {
      const response = await fetch(
        `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to,
            type: 'text',
            text: { body: chunk },
          }),
        }
      );
      const result = await response.json();
      if (!response.ok) {
        console.error('Meta API error:', JSON.stringify(result));
      }
    } catch (err) {
      console.error('Failed to send message:', err);
    }
  }
}

// ============================================================
// DAILY SUMMARY CRON (5pm Costa Rica = UTC-6 → 23:00 UTC)
// ============================================================

async function sendDailySummary() {
  console.log('Running daily summary...');

  try {
    // Get today's movements
    const { data: movimientos, error: movErr } = await supabase
      .from('movimientos_hoy')
      .select('*');

    if (movErr) {
      console.error('Error fetching daily summary:', movErr);
      return;
    }

    // Get users who should receive the summary
    const { data: usuarios, error: usrErr } = await supabase
      .from('usuarios')
      .select('telefono, nombre')
      .eq('activo', true)
      .eq('recibe_resumen_diario', true);

    if (usrErr || !usuarios?.length) {
      console.log('No users configured for daily summary');
      return;
    }

    // Build summary message
    let message;
    if (!movimientos || movimientos.length === 0) {
      message = '📋 Resumen del día\n\nNo se registraron compras hoy.';
    } else {
      const totalGastado = movimientos.reduce((sum, m) => sum + (m.precio_total || 0), 0);

      message = `📋 Resumen del día\n\n`;
      message += `Total de compras: ${movimientos.length}\n`;
      message += `Total gastado: ₡${totalGastado.toLocaleString('es-CR')}\n\n`;

      // Group by project
      const byProject = {};
      for (const m of movimientos) {
        const proj = m.proyecto || 'Sin proyecto';
        if (!byProject[proj]) byProject[proj] = [];
        byProject[proj].push(m);
      }

      for (const [proyecto, items] of Object.entries(byProject)) {
        const projTotal = items.reduce((sum, m) => sum + (m.precio_total || 0), 0);
        message += `🏗️ ${proyecto} (₡${projTotal.toLocaleString('es-CR')})\n`;
        for (const item of items) {
          message += `  - ${item.cantidad} ${item.unidad} de ${item.material}`;
          if (item.precio_total) message += ` — ₡${item.precio_total.toLocaleString('es-CR')}`;
          message += '\n';
        }
        message += '\n';
      }
    }

    // Send to all configured users
    for (const user of usuarios) {
      await sendWhatsAppMessage(user.telefono, message);
      console.log(`Daily summary sent to ${user.nombre} (${user.telefono})`);
    }
  } catch (err) {
    console.error('Error in daily summary:', err);
  }
}

// Schedule daily summary — check every minute if it's 5pm Costa Rica time
function startDailyCron() {
  let lastRun = null;

  setInterval(() => {
    const now = new Date();
    // Costa Rica is UTC-6
    const crHour = (now.getUTCHours() - 6 + 24) % 24;
    const crMinute = now.getUTCMinutes();
    const today = now.toISOString().split('T')[0];

    // Run at 17:00 (5pm) Costa Rica time, once per day
    if (crHour === 17 && crMinute === 0 && lastRun !== today) {
      lastRun = today;
      sendDailySummary();
    }
  }, 60 * 1000); // Check every minute

  console.log('Daily summary cron started — runs at 5pm Costa Rica time');
}

// ============================================================
// HTTP SERVER
// ============================================================

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('Proveeduria webhook running — v2 with Supabase + Tools');
  }

  if (url.pathname === '/webhook' && req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
      console.log('Webhook verified successfully');
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end(challenge);
    }
    console.warn('Webhook verification failed — token mismatch');
    res.writeHead(403);
    return res.end('Forbidden');
  }

  if (url.pathname === '/webhook' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      res.writeHead(200);
      res.end('OK');

      try {
        const data = JSON.parse(body);
        const entry = data.entry?.[0];
        const changes = entry?.changes?.[0];
        const value = changes?.value;
        const message = value?.messages?.[0];

        if (message) {
          const from = message.from;
          const type = message.type;

          if (type === 'text') {
            const text = message.text?.body || '';
            console.log(`Message from ${from}: ${text}`);

            askClaude(from, text)
              .then((reply) => {
                console.log(`Reply to ${from}: ${reply.substring(0, 100)}...`);
                return sendWhatsAppMessage(from, reply);
              })
              .catch((err) => {
                console.error('Error in message pipeline:', err);
              });
          } else if (type === 'image') {
            const mediaId = message.image?.id;
            const caption = message.image?.caption || '';
            console.log(`Image from ${from} (media_id: ${mediaId})`);

            if (mediaId) {
              processInvoiceImage(from, mediaId, caption)
                .then((reply) => {
                  console.log(`Image reply to ${from}: ${reply.substring(0, 100)}...`);
                  return sendWhatsAppMessage(from, reply);
                })
                .catch((err) => {
                  console.error('Error in image pipeline:', err);
                  sendWhatsAppMessage(
                    from,
                    'Mae, no pude procesar esa imagen. Intentá de nuevo 📸'
                  );
                });
            }
          } else {
            console.log(`Unsupported message type from ${from}: ${type}`);
            sendWhatsAppMessage(
              from,
              'Por ahora solo puedo leer mensajes de texto y fotos de facturas 📸'
            );
          }
        }
      } catch (err) {
        console.error('Error processing webhook:', err);
      }
    });
    return;
  }

  // Manual trigger for daily summary (useful for testing)
  if (url.pathname === '/test-summary' && req.method === 'GET') {
    sendDailySummary();
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('Daily summary triggered');
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  startDailyCron();
});