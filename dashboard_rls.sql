-- ============================================================
-- Policies SELECT-for-anon para el dashboard React
-- Ejecutar en Supabase SQL Editor DESPUÉS del schema base y del
-- contratistas_ddl.sql. La app usa la anon key para leer estas tablas.
-- ============================================================

-- proyectos
create policy "Proyectos lectura anon (dashboard)"
  on public.proyectos for select
  to anon
  using (true);

-- movimientos
create policy "Movimientos lectura anon (dashboard)"
  on public.movimientos for select
  to anon
  using (true);

-- usuarios (se usa en joins: movimientos.usuarios(nombre))
-- Política restringida a solo lo necesario para el dashboard:
create policy "Usuarios lectura anon (dashboard)"
  on public.usuarios for select
  to anon
  using (true);

-- contratistas / contratos / órdenes / pagos (v_resumen_contratos hace joins)
create policy "Contratistas lectura anon (dashboard)"
  on public.contratistas for select
  to anon
  using (true);

create policy "Contratos lectura anon (dashboard)"
  on public.contratos for select
  to anon
  using (true);

create policy "Ordenes cambio lectura anon (dashboard)"
  on public.ordenes_cambio for select
  to anon
  using (true);

create policy "Pagos contratista lectura anon (dashboard)"
  on public.pagos_contratista for select
  to anon
  using (true);

-- NOTA: las views resumen_gastos_proyecto y v_resumen_contratos heredan los
-- permisos RLS de las tablas subyacentes — no requieren policies propias.

-- NOTA: el bucket de Storage 'facturas' permanece privado. El dashboard NO
-- accede a imágenes de facturas. Si en el futuro querés exponer thumbnails,
-- generalos con signed URLs desde el server.

-- NOTA: facturas y retroalimentacion NO se exponen al dashboard. Si querés
-- mostrarlas en el futuro, agregá policies equivalentes aquí.
