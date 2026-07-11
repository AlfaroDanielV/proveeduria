-- 001_base.sql
-- Datos base idempotentes (ON CONFLICT DO NOTHING, UUIDs/keys fijos).
-- Fuente: docs/specs/data-model.md, docs/specs/exceptions.md §3,
-- Propuesta v3 §4.1 (actores) y §3.1 (roles).

-- ---------------------------------------------------------------------------
-- Roles (catalogo fijo de 5, data-model.md §Identidad y acceso)
-- ---------------------------------------------------------------------------
insert into roles (id, clave, descripcion) values
  ('10000000-0000-4000-8000-000000000001', 'superadmin',       'Gerencia / superadministrador: lectura amplia, cancelacion, config.'),
  ('10000000-0000-4000-8000-000000000002', 'admin_materiales', 'Proveeduria: gestiona pedidos, cotizaciones, OC y cierre.'),
  ('10000000-0000-4000-8000-000000000003', 'admin_equipos',    'Servicios Generales: equipos de alquiler e inventario.'),
  ('10000000-0000-4000-8000-000000000004', 'ingeniero',        'Solicita pedidos de material para su proyecto.'),
  ('10000000-0000-4000-8000-000000000005', 'bodeguero',        'Recibe material, registra facturas y confirma recepcion.')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Usuarios: los 5 actores del PDF §4.1, cada uno con su rol.
-- Telefonos E.164 de placeholder (unicos); reemplazar por reales en carga piloto.
-- ---------------------------------------------------------------------------
insert into users (id, nombre, telefono_whatsapp, email, activo) values
  ('20000000-0000-4000-8000-000000000001', 'Gerencia Atemporal',      '+50688880001', 'gerencia@atemporal.cr',  true),
  ('20000000-0000-4000-8000-000000000002', 'Jose Pablo (Proveeduria)','+50688880002', 'proveeduria@atemporal.cr', true),
  ('20000000-0000-4000-8000-000000000003', 'Bernal (Serv. Generales)','+50688880003', 'equipos@atemporal.cr',   true),
  ('20000000-0000-4000-8000-000000000004', 'Ingeniero de Obra',       '+50688880004', 'ingenieria@atemporal.cr', true),
  ('20000000-0000-4000-8000-000000000005', 'Bodeguero',               '+50688880005', 'bodega@atemporal.cr',    true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Proyectos (2)
-- ---------------------------------------------------------------------------
insert into projects (id, nombre, codigo, presupuesto_referencia, activo) values
  ('30000000-0000-4000-8000-000000000001', 'Residencial Lopez', 'LOP', 500000000.00, true),
  ('30000000-0000-4000-8000-000000000002', 'Torre Escazu',      'ESC', 750000000.00, true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Asignacion usuario -> rol (user_roles). Ingeniero/bodeguero acotados al
-- proyecto Lopez a modo de ejemplo; superadmin/proveeduria sin proyecto.
-- ---------------------------------------------------------------------------
insert into user_roles (id, user_id, role_id, project_id) values
  ('60000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', null),
  ('60000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', null),
  ('60000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000003', null),
  ('60000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000001'),
  ('60000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000005', '30000000-0000-4000-8000-000000000001')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Proveedores (2) con contactos
-- ---------------------------------------------------------------------------
insert into suppliers (id, nombre, cedula_juridica, categorias, activo, notas) values
  ('40000000-0000-4000-8000-000000000001', 'Rodex',    '3-101-111111', '{cemento,varilla,agregados}', true, 'Proveedor de estructura.'),
  ('40000000-0000-4000-8000-000000000002', 'El Lagar', '3-101-222222', '{materiales,acabados,ferreteria}', true, 'Materiales generales.')
on conflict (id) do nothing;

insert into supplier_contacts (id, supplier_id, nombre, telefono_whatsapp, optin_at, es_principal) values
  ('50000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'Ventas Rodex',    '+50688881001', now(), true),
  ('50000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002', 'Ventas El Lagar', '+50688881002', now(), true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Config: umbrales iniciales (exceptions.md §3). Editable por superadmin.
-- ---------------------------------------------------------------------------
insert into config (clave, valor, descripcion) values
  ('confianza_min_cotizacion',       '0.8',   'E2: confianza minima de extraccion para cotizacion completa.'),
  ('max_repreguntas_proveedor',      '2',     'E2: maximo de repreguntas a un proveedor antes de escalar.'),
  ('confianza_min_factura',          '0.85',  'E9: confianza minima de extraccion de factura (monto/numero).'),
  ('dif_monto_rel_max',              '0.01',  'E4: diferencia relativa maxima tolerada factura vs OC (1%).'),
  ('dif_monto_abs_min_crc',          '10000', 'E4: piso absoluto de tolerancia de diferencia de monto (CRC).'),
  ('dif_cantidad_menor',             '0',     'E5: diferencia de cantidad recibida considerada menor (no bloquea).'),
  ('plazo_cotizacion_horas_default', '24',    'RFQ: plazo por defecto para cotizar (horas).'),
  ('horas_atasco_en_revision',       '24',    'E13: horas en en_revision sin decision antes de recordatorio.'),
  ('horas_atasco_aprobado',          '48',    'E13: horas en aprobado sin OC confirmada antes de recordatorio.')
on conflict (clave) do nothing;
