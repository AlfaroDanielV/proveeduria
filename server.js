const http = require('http');
const crypto = require('crypto');
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
- Si el usuario reporta un error (ej: "Error: me cobró doble", "eso está mal", "te equivocaste"), registrá la retroalimentación con registrar_retroalimentacion, guardá los detalles, agradecé, y decile que Daniel lo va a revisar.
- Si el usuario hace una sugerencia ("sería bueno que...", "deberían agregar..."), también registrala como tipo 'sugerencia'.
- Este chat es EXCLUSIVAMENTE para temas de proveeduría y gestión de proyectos de la empresa. Si alguien te pregunta cosas personales, te pide ayuda con tareas, recetas, chistes, traducciones, o cualquier cosa que no tenga que ver con el trabajo, respondé amablemente que solo podés ayudar con temas de proveeduría. Ejemplo: "Mae, con gusto te ayudaría pero este canal es solo para el registro de compras y materiales de los proyectos. ¿Ocupás registrar algo? 📋"
- No sos un asistente general. No respondás preguntas de cultura general, no hagás cálculos que no sean de materiales o costos de proyectos, y no des consejos sobre temas ajenos al negocio.

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

CONTRATISTAS:
- Los contratistas son personas o empresas contratadas para un proyecto (electricistas, albañiles, pintores, etc.).
- Flujo: 1) registrar_contratista (catálogo maestro) → 2) registrar_contrato (liga contratista a proyecto con monto_original) → 3a) registrar_pago_contratista por cada abono/cuota, o 3b) registrar_orden_cambio para ajustes (+/-) al monto.
- consultar_contratistas te devuelve el resumen con monto_vigente, total_pagado, saldo_pendiente y porcentaje_pagado.
- Antes de registrar un pago, mostrá al usuario el saldo_pendiente actual. Si el monto excede el saldo, pedí confirmación explícita (usá confirmar_sobregiro=true solo si el usuario lo aprueba).
- Antes de registrar una orden de cambio, confirmá con el usuario el monto (con signo) y la descripción.
- Si el servidor devuelve { error: 'permiso_denegado' }, decile al usuario con amabilidad que esa acción requiere permisos de admin y que hable con Daniel.

FORMATO DE RESPUESTA:
- Usá formato simple, sin markdown pesado (WhatsApp no lo renderiza bien).
- Listas con guiones simples o números.
- Montos con separador de miles: ₡1.500, ₡25.000, ₡1.250.000
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
    name: 'registrar_retroalimentacion',
    description: 'Registra retroalimentación del usuario sobre errores o sugerencias. Usala cuando el usuario reporte un error (mensajes que empiezan con "Error:" o similares) o haga una sugerencia sobre el sistema.',
    input_schema: {
      type: 'object',
      properties: {
        detalle: {
          type: 'string',
          description: 'Descripción del error o sugerencia reportada por el usuario.',
        },
        tipo: {
          type: 'string',
          enum: ['error', 'sugerencia', 'otro'],
          description: 'Tipo de retroalimentación.',
        },
      },
      required: ['detalle', 'tipo'],
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
  {
    name: 'registrar_contratista',
    description: 'Registra un nuevo contratista en el catálogo maestro. Solo admin/superadmin. Antes de insertar verifica duplicados por nombre (case-insensitive); si hay coincidencia, devuelve una advertencia y el usuario debe confirmar.',
    input_schema: {
      type: 'object',
      properties: {
        nombre: { type: 'string', description: 'Nombre del contratista (persona o empresa).' },
        especialidad: { type: 'string', description: 'Especialidad (electricista, albañilería, pintura, etc.). Opcional.' },
        telefono: { type: 'string', description: 'Teléfono de contacto. Opcional.' },
        notas: { type: 'string', description: 'Notas adicionales. Opcional.' },
        confirmar_duplicado: {
          type: 'boolean',
          description: 'Poné true solo cuando el usuario YA confirmó que es un contratista distinto pese al nombre similar. Default: false.',
        },
      },
      required: ['nombre'],
    },
  },
  {
    name: 'registrar_contrato',
    description: 'Registra un contrato entre un contratista y un proyecto con un monto original. Solo admin/superadmin. Si no tenés el contratista_id o proyecto_id, usá consultar_contratistas o listar_proyectos primero.',
    input_schema: {
      type: 'object',
      properties: {
        contratista_id: { type: 'string', description: 'UUID del contratista.' },
        proyecto_id: { type: 'string', description: 'UUID del proyecto.' },
        descripcion: { type: 'string', description: 'Descripción del trabajo contratado.' },
        monto_original: { type: 'number', description: 'Monto original en colones.' },
        fecha_inicio: { type: 'string', description: 'Fecha de inicio (YYYY-MM-DD). Opcional.' },
        fecha_fin_estimada: { type: 'string', description: 'Fecha estimada de fin (YYYY-MM-DD). Opcional.' },
        notas: { type: 'string', description: 'Notas adicionales. Opcional.' },
      },
      required: ['contratista_id', 'proyecto_id', 'monto_original'],
    },
  },
  {
    name: 'registrar_orden_cambio',
    description: 'Registra un ajuste (positivo o negativo) al monto de un contrato existente. Solo admin/superadmin. SIEMPRE confirmá monto (con signo) y descripción con el usuario antes de llamar esta tool.',
    input_schema: {
      type: 'object',
      properties: {
        contrato_id: { type: 'string', description: 'UUID del contrato.' },
        descripcion: { type: 'string', description: 'Razón del ajuste (ej: "Trabajo adicional de pintura en exteriores").' },
        monto: { type: 'number', description: 'Monto del ajuste en colones. Puede ser negativo.' },
        fecha: { type: 'string', description: 'Fecha del ajuste (YYYY-MM-DD). Default: hoy.' },
      },
      required: ['contrato_id', 'descripcion', 'monto'],
    },
  },
  {
    name: 'registrar_pago_contratista',
    description: 'Registra un pago/cuota a un contratista sobre un contrato. Admin, superadmin u operativo. Antes de llamar, consultá el saldo_pendiente con consultar_contratistas. Si el pago excede el saldo, el servidor devolverá una advertencia — pedí confirmación al usuario y reintentá con confirmar_sobregiro=true.',
    input_schema: {
      type: 'object',
      properties: {
        contrato_id: { type: 'string', description: 'UUID del contrato.' },
        monto: { type: 'number', description: 'Monto del pago en colones (positivo).' },
        fecha_pago: { type: 'string', description: 'Fecha del pago (YYYY-MM-DD). Default: hoy.' },
        numero_cuota: { type: 'number', description: 'Número de cuota si aplica. Opcional.' },
        descripcion: { type: 'string', description: 'Descripción del pago. Opcional.' },
        confirmar_sobregiro: {
          type: 'boolean',
          description: 'Poné true solo cuando el usuario YA confirmó que quiere pagar más que el saldo_pendiente. Default: false.',
        },
      },
      required: ['contrato_id', 'monto'],
    },
  },
  {
    name: 'consultar_contratistas',
    description: 'Consulta contratos y resúmenes financieros (monto vigente, pagado, saldo pendiente, % pagado). Accesible para todos los roles. Sin filtros devuelve todos los contratos activos.',
    input_schema: {
      type: 'object',
      properties: {
        contratista_id: { type: 'string', description: 'Filtrar por UUID de contratista. Opcional.' },
        proyecto_id: { type: 'string', description: 'Filtrar por UUID de proyecto. Opcional.' },
        contrato_id: { type: 'string', description: 'Filtrar por UUID de contrato. Opcional.' },
        estado: {
          type: 'string',
          enum: ['activo', 'finalizado', 'cancelado'],
          description: 'Filtrar por estado. Si se omite, devuelve solo activos.',
        },
        incluir_pagos: {
          type: 'boolean',
          description: 'Si true, incluye el historial de pagos de cada contrato. Default: false.',
        },
      },
      required: [],
    },
  },
  {
    name: 'generar_link_dashboard',
    description: 'Genera un enlace temporal al dashboard web de un proyecto. Solo admin/superadmin. Respondé al usuario con un mensaje corto y el link.',
    input_schema: {
      type: 'object',
      properties: {
        proyecto_id: { type: 'string', description: 'UUID del proyecto.' },
        horas_validez: {
          type: 'number',
          description: 'Horas que el link permanece activo. Default: 24. Máximo: 168.',
        },
      },
      required: ['proyecto_id'],
    },
  },
];

// ============================================================
// TOOL HANDLERS
// ============================================================

// Roles requeridos por tool. Si la tool no aparece aquí, no hay restricción.
const TOOL_ROLES = {
  registrar_contratista: ['admin', 'superadmin'],
  registrar_contrato: ['admin', 'superadmin'],
  registrar_orden_cambio: ['admin', 'superadmin'],
  registrar_pago_contratista: ['admin', 'superadmin', 'operativo'],
  generar_link_dashboard: ['admin', 'superadmin'],
};

// ============================================================
// DASHBOARD JWT (HS256, sin dependencias externas)
// ============================================================

function base64urlEncode(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function signDashboardToken(payload, secret, expiresInSeconds) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + expiresInSeconds };
  const h = base64urlEncode(JSON.stringify(header));
  const p = base64urlEncode(JSON.stringify(body));
  const toSign = `${h}.${p}`;
  const sig = base64urlEncode(
    crypto.createHmac('sha256', secret).update(toSign).digest()
  );
  return `${toSign}.${sig}`;
}

async function handleTool(toolName, input, phoneNumber) {
  // Buscar usuario por teléfono
  const { data: usuario } = await supabase
    .from('usuarios')
    .select('id, nombre, rol')
    .eq('telefono', phoneNumber)
    .single();

  const userId = usuario?.id || null;
  const userRole = usuario?.rol || null;

  // Role gate — devuelve un resultado estructurado que Claude traduce al usuario
  const requiredRoles = TOOL_ROLES[toolName];
  if (requiredRoles && !requiredRoles.includes(userRole)) {
    return JSON.stringify({
      error: 'permiso_denegado',
      tool: toolName,
      rol_actual: userRole,
      roles_requeridos: requiredRoles,
      mensaje: `Esta acción requiere rol ${requiredRoles.join(' o ')}.`,
    });
  }

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
    case 'registrar_retroalimentacion': {
      // Capturar últimos mensajes como contexto
      const conversacion = getConversation(phoneNumber);
      const contexto = conversacion.slice(-6);

      const { data, error } = await supabase
        .from('retroalimentacion')
        .insert({
          reportado_por: userId,
          reportado_telefono: phoneNumber,
          tipo: input.tipo,
          detalle: input.detalle,
          contexto_conversacion: contexto,
        })
        .select()
        .single();

      if (error) throw new Error(`Error registrando retroalimentación: ${error.message}`);

      return JSON.stringify({
        success: true,
        id: data.id,
        tipo: input.tipo,
        detalle: input.detalle,
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

    case 'registrar_contratista': {
      if (!input.confirmar_duplicado) {
        const { data: dup } = await supabase
          .from('contratistas')
          .select('id, nombre, especialidad, telefono, activo')
          .ilike('nombre', input.nombre)
          .eq('activo', true);

        if (dup && dup.length > 0) {
          return JSON.stringify({
            warning: 'posible_duplicado',
            coincidencias: dup,
            mensaje:
              'Ya existe un contratista con nombre igual o similar. Mostrá las coincidencias al usuario y pedile que confirme. Si confirma que es uno distinto, reintentá con confirmar_duplicado=true.',
          });
        }
      }

      const { data, error } = await supabase
        .from('contratistas')
        .insert({
          nombre: input.nombre,
          especialidad: input.especialidad || null,
          telefono: input.telefono || null,
          notas: input.notas || null,
          creado_por: userId,
        })
        .select()
        .single();

      if (error) throw new Error(`Error registrando contratista: ${error.message}`);

      return JSON.stringify({
        success: true,
        contratista_id: data.id,
        nombre: data.nombre,
        especialidad: data.especialidad,
      });
    }

    case 'registrar_contrato': {
      const { data, error } = await supabase
        .from('contratos')
        .insert({
          contratista_id: input.contratista_id,
          proyecto_id: input.proyecto_id,
          descripcion: input.descripcion || null,
          monto_original: input.monto_original,
          fecha_inicio: input.fecha_inicio || null,
          fecha_fin_estimada: input.fecha_fin_estimada || null,
          notas: input.notas || null,
          creado_por: userId,
        })
        .select(
          `id, descripcion, monto_original, fecha_inicio, fecha_fin_estimada, estado,
           contratistas(nombre, especialidad),
           proyectos(nombre)`
        )
        .single();

      if (error) throw new Error(`Error registrando contrato: ${error.message}`);

      return JSON.stringify({
        success: true,
        contrato_id: data.id,
        contratista: data.contratistas?.nombre,
        especialidad: data.contratistas?.especialidad,
        proyecto: data.proyectos?.nombre,
        descripcion: data.descripcion,
        monto_original: data.monto_original,
        fecha_inicio: data.fecha_inicio,
        fecha_fin_estimada: data.fecha_fin_estimada,
        estado: data.estado,
      });
    }

    case 'registrar_orden_cambio': {
      const { data, error } = await supabase
        .from('ordenes_cambio')
        .insert({
          contrato_id: input.contrato_id,
          descripcion: input.descripcion,
          monto: input.monto,
          fecha: input.fecha || new Date().toISOString().split('T')[0],
          creado_por: userId,
        })
        .select()
        .single();

      if (error) throw new Error(`Error registrando orden de cambio: ${error.message}`);

      const { data: resumen } = await supabase
        .from('v_resumen_contratos')
        .select('contratista_nombre, proyecto_nombre, monto_vigente, total_pagado, saldo_pendiente, porcentaje_pagado')
        .eq('contrato_id', input.contrato_id)
        .single();

      return JSON.stringify({
        success: true,
        orden_id: data.id,
        monto_ajuste: data.monto,
        descripcion: data.descripcion,
        fecha: data.fecha,
        contratista: resumen?.contratista_nombre,
        proyecto: resumen?.proyecto_nombre,
        nuevo_monto_vigente: resumen?.monto_vigente,
        total_pagado: resumen?.total_pagado,
        nuevo_saldo_pendiente: resumen?.saldo_pendiente,
        porcentaje_pagado: resumen?.porcentaje_pagado,
      });
    }

    case 'registrar_pago_contratista': {
      const { data: resumen, error: resErr } = await supabase
        .from('v_resumen_contratos')
        .select('contratista_nombre, proyecto_nombre, monto_vigente, total_pagado, saldo_pendiente, porcentaje_pagado')
        .eq('contrato_id', input.contrato_id)
        .single();

      if (resErr || !resumen) throw new Error('Contrato no encontrado.');

      if (input.monto > resumen.saldo_pendiente && !input.confirmar_sobregiro) {
        return JSON.stringify({
          warning: 'pago_excede_saldo',
          contratista: resumen.contratista_nombre,
          proyecto: resumen.proyecto_nombre,
          saldo_pendiente: resumen.saldo_pendiente,
          monto_solicitado: input.monto,
          excedente: input.monto - resumen.saldo_pendiente,
          mensaje:
            'El pago excede el saldo pendiente del contrato. Mostrá los números al usuario y pedile que confirme el sobregiro. Si confirma, reintentá con confirmar_sobregiro=true.',
        });
      }

      const { data, error } = await supabase
        .from('pagos_contratista')
        .insert({
          contrato_id: input.contrato_id,
          monto: input.monto,
          fecha_pago: input.fecha_pago || new Date().toISOString().split('T')[0],
          numero_cuota: input.numero_cuota || null,
          descripcion: input.descripcion || null,
          registrado_por: userId,
        })
        .select()
        .single();

      if (error) throw new Error(`Error registrando pago: ${error.message}`);

      const { data: nuevoResumen } = await supabase
        .from('v_resumen_contratos')
        .select('contratista_nombre, proyecto_nombre, monto_vigente, total_pagado, saldo_pendiente, porcentaje_pagado')
        .eq('contrato_id', input.contrato_id)
        .single();

      return JSON.stringify({
        success: true,
        pago_id: data.id,
        monto_pagado: data.monto,
        fecha_pago: data.fecha_pago,
        numero_cuota: data.numero_cuota,
        contratista: nuevoResumen?.contratista_nombre,
        proyecto: nuevoResumen?.proyecto_nombre,
        monto_vigente: nuevoResumen?.monto_vigente,
        total_pagado: nuevoResumen?.total_pagado,
        saldo_pendiente: nuevoResumen?.saldo_pendiente,
        porcentaje_pagado: nuevoResumen?.porcentaje_pagado,
      });
    }

    case 'generar_link_dashboard': {
      const secret = process.env.DASHBOARD_JWT_SECRET;
      const baseUrl = process.env.DASHBOARD_BASE_URL;

      if (!secret) throw new Error('DASHBOARD_JWT_SECRET no está configurado.');
      if (!baseUrl) throw new Error('DASHBOARD_BASE_URL no está configurada.');

      const { data: proyecto, error: pErr } = await supabase
        .from('proyectos')
        .select('id, nombre')
        .eq('id', input.proyecto_id)
        .single();

      if (pErr || !proyecto) throw new Error('Proyecto no encontrado.');

      const horas = Math.min(Math.max(input.horas_validez || 24, 1), 168);
      const token = signDashboardToken(
        { proyecto_id: proyecto.id, sub: userId || phoneNumber, rol: userRole },
        secret,
        horas * 3600
      );
      const link = `${baseUrl.replace(/\/$/, '')}/proyecto/${proyecto.id}?token=${token}`;

      return JSON.stringify({
        success: true,
        proyecto: proyecto.nombre,
        link,
        validez_horas: horas,
      });
    }

    case 'consultar_contratistas': {
      let query = supabase.from('v_resumen_contratos').select('*');

      if (input.contrato_id) query = query.eq('contrato_id', input.contrato_id);
      if (input.contratista_id) query = query.eq('contratista_id', input.contratista_id);
      if (input.proyecto_id) query = query.eq('proyecto_id', input.proyecto_id);
      query = query.eq('estado', input.estado || 'activo');

      const { data, error } = await query.order('proyecto_nombre', { ascending: true });
      if (error) throw new Error(`Error consultando contratistas: ${error.message}`);

      const contratos = data || [];

      if (input.incluir_pagos && contratos.length > 0) {
        for (const c of contratos) {
          const { data: pagos } = await supabase
            .from('pagos_contratista')
            .select('id, monto, fecha_pago, numero_cuota, descripcion')
            .eq('contrato_id', c.contrato_id)
            .order('fecha_pago', { ascending: false });
          c.pagos = pagos || [];
        }
      }

      return JSON.stringify({
        total: contratos.length,
        estado_filtrado: input.estado || 'activo',
        contratos,
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
        model: 'claude-sonnet-4-6',
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

function extensionForMime(mimeType) {
  if (!mimeType) return 'bin';
  if (mimeType.includes('pdf')) return 'pdf';
  if (mimeType.includes('png')) return 'png';
  if (mimeType.includes('webp')) return 'webp';
  if (mimeType.includes('gif')) return 'gif';
  return 'jpeg';
}

async function uploadToSupabase(buffer, mimeType) {
  const ext = extensionForMime(mimeType);
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

// Límite seguro para documentos enviados a Claude (fotos y PDFs).
// Claude acepta hasta ~5MB; dejamos margen para base64 overhead.
const MAX_DOC_BYTES = 4.5 * 1024 * 1024;

// Handler unificado para fotos y PDFs. El guardarraíl primario es la factura
// (caso más frecuente), pero Claude puede procesar otros docs de construcción.
async function handleDocumentMessage(message, usuario) {
  const phoneNumber = message.from;
  const type = message.type;
  const payload = type === 'document' ? message.document : message.image;
  const mediaId = payload?.id;
  const caption = payload?.caption || '';
  const filename = payload?.filename || '';

  if (!mediaId) {
    return 'Mae, no encontré el archivo adjunto. Intentá enviarlo de nuevo 📎';
  }

  try {
    const { buffer, mimeType } = await downloadWhatsAppMedia(mediaId);

    if (buffer.byteLength > MAX_DOC_BYTES) {
      const mb = (buffer.byteLength / (1024 * 1024)).toFixed(1);
      return `Mae, el archivo está muy grande (${mb} MB). El máximo es 4.5 MB. ¿Podés mandarme una foto más clara o un PDF más liviano? 📎`;
    }

    const isPdf = type === 'document' || (mimeType || '').includes('pdf');

    // Guardamos en Storage para auditoría (igual que el flujo original de facturas).
    const { path, url } = await uploadToSupabase(buffer, mimeType);

    const base64Data = buffer.toString('base64');
    const mediaBlock = isPdf
      ? {
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: base64Data,
          },
        }
      : {
          type: 'image',
          source: {
            type: 'base64',
            media_type: mimeType || 'image/jpeg',
            data: base64Data,
          },
        };

    const docLabel = isPdf
      ? `un PDF${filename ? ` ("${filename}")` : ''}`
      : 'una foto';
    const contextoUsuario = usuario?.nombre
      ? ` Remitente: ${usuario.nombre} (rol ${usuario.rol}).`
      : '';
    const contextoCaption = caption ? `\nMensaje del usuario junto con el archivo: "${caption}"` : '';

    const instrucciones = `El usuario envió ${docLabel}.${contextoUsuario}${contextoCaption}

INSTRUCCIONES para procesar este documento:

1. Primero decidí qué tipo de documento es. Debe ser relacionado a construcción: factura, recibo, nota de entrega, cotización, contrato, plano, orden de compra, etc. Si claramente NO es un documento de construcción (por ejemplo: foto personal, meme, documento de otra industria sin relación al trabajo), NO llamés ninguna tool. Respondé amablemente al usuario que este canal solo procesa documentos relacionados a los proyectos.

2. CASO PRINCIPAL — FACTURA o RECIBO: Es lo más frecuente. Extraé: proveedor, fecha, items (material, cantidad, unidad, precio unitario, precio total) y total general. Luego llamá la tool registrar_factura_escaneada con esos datos:
   - imagen_url: "${url}"
   - imagen_path: "${path}"
   Después mostrá los datos al usuario y pedí confirmación siguiendo el FLUJO DE FACTURA definido en tu prompt.

3. OTROS DOCUMENTOS DE CONSTRUCCIÓN (cotización, contrato, nota de entrega, etc.): resumí al usuario lo que encontraste (proveedor, fecha, montos relevantes, items principales o puntos clave) y preguntale qué querés que haga con eso. NO registrés como factura sin confirmación explícita.

4. Si la imagen/PDF está borroso o no podés leer algo clave, decilo claramente y pedí otra foto o PDF más legible.`;

    const userContent = [mediaBlock, { type: 'text', text: instrucciones }];

    const reply = await askClaude(phoneNumber, userContent);
    return reply;
  } catch (err) {
    console.error('Error processing document:', err);
    return 'Mae, no pude procesar ese archivo. ¿Podés mandarlo de nuevo? Si es foto, asegurate que esté bien iluminada y enfocada 📎';
  }
}

// ============================================================
// WHATSAPP VOICE HANDLING (OpenAI Whisper)
// ============================================================

async function transcribeAudio(buffer, mimeType) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY no está configurada.');

  // WhatsApp voice notes son audio/ogg; opus. Whisper detecta por extensión.
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimeType || 'audio/ogg' }), 'audio.ogg');
  form.append('model', 'whisper-1');
  form.append('language', 'es');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Whisper API error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return (data.text || '').trim();
}

async function processVoiceMessage(phoneNumber, mediaId) {
  try {
    const { buffer, mimeType } = await downloadWhatsAppMedia(mediaId);
    const transcription = await transcribeAudio(buffer, mimeType);

    if (!transcription) {
      return 'Mae, no logré entender la nota de voz. ¿Podés mandarla de nuevo o escribirme el mensaje? 🎙️';
    }

    console.log(`Transcription for ${phoneNumber}: ${transcription}`);

    const userInput = `🎙️ Escuché: "${transcription}"\n\n${transcription}`;
    const reply = await askClaude(phoneNumber, userInput);
    return reply;
  } catch (err) {
    console.error('Error processing voice message:', err);
    return 'Mae, no pude procesar la nota de voz. Intentá de nuevo o escribime el mensaje por favor 🎙️';
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
          } else if (type === 'image' || type === 'document') {
            console.log(`${type === 'document' ? 'Document' : 'Image'} from ${from}`);

            supabase
              .from('usuarios')
              .select('id, nombre, rol')
              .eq('telefono', from)
              .single()
              .then(({ data: usuario }) =>
                handleDocumentMessage(message, usuario || null)
              )
              .then((reply) => {
                console.log(`Document reply to ${from}: ${reply.substring(0, 100)}...`);
                return sendWhatsAppMessage(from, reply);
              })
              .catch((err) => {
                console.error('Error in document pipeline:', err);
                sendWhatsAppMessage(
                  from,
                  'Mae, no pude procesar ese archivo. Intentá de nuevo 📎'
                );
              });
          } else if (type === 'audio') {
            const mediaId = message.audio?.id;
            console.log(`Audio from ${from} (media_id: ${mediaId})`);

            if (mediaId) {
              processVoiceMessage(from, mediaId)
                .then((reply) => {
                  console.log(`Voice reply to ${from}: ${reply.substring(0, 100)}...`);
                  return sendWhatsAppMessage(from, reply);
                })
                .catch((err) => {
                  console.error('Error in voice pipeline:', err);
                  sendWhatsAppMessage(
                    from,
                    'Mae, no pude procesar la nota de voz. Intentá de nuevo o escribime el mensaje 🎙️'
                  );
                });
            }
          } else {
            console.log(`Unsupported message type from ${from}: ${type}`);
            sendWhatsAppMessage(
              from,
              'Por ahora solo puedo leer mensajes de texto, notas de voz y fotos 📸🎙️'
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
