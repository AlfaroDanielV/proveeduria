import { useEffect, useState } from 'react';
import { useParams, useSearchParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { decodeJWT, isExpired } from '../utils/jwt';
import { formatColones, formatDate } from '../utils/format';

export default function ProjectDashboard() {
  const { proyectoId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const token = searchParams.get('token');
    if (!token) {
      navigate('/token-invalido', { replace: true });
      return;
    }
    const payload = decodeJWT(token);
    if (!payload || isExpired(payload) || payload.proyecto_id !== proyectoId) {
      navigate('/token-invalido', { replace: true });
      return;
    }

    (async () => {
      try {
        const [proyecto, contratos, movimientos, resumen] = await Promise.all([
          supabase.from('proyectos').select('*').eq('id', proyectoId).single(),
          supabase.from('v_resumen_contratos').select('*').eq('proyecto_id', proyectoId),
          supabase
            .from('movimientos')
            .select(
              'id, fecha_compra, material, cantidad, unidad, precio_total, proveedor, usuarios(nombre)'
            )
            .eq('proyecto_id', proyectoId)
            .order('fecha_compra', { ascending: false })
            .limit(20),
          supabase
            .from('resumen_gastos_proyecto')
            .select('*')
            .eq('proyecto_id', proyectoId)
            .maybeSingle(),
        ]);

        if (proyecto.error) throw proyecto.error;

        setData({
          proyecto: proyecto.data,
          contratos: contratos.data || [],
          movimientos: movimientos.data || [],
          resumen: resumen.data || null,
        });
      } catch (e) {
        setError(e.message || 'Error cargando datos');
      }
    })();
  }, [proyectoId, searchParams, navigate]);

  if (error) {
    return (
      <div className="min-h-full p-6 text-center text-rose-600 bg-slate-50">
        Error: {error}
      </div>
    );
  }
  if (!data) {
    return (
      <div className="min-h-full p-6 text-center text-slate-500 bg-slate-50">
        Cargando…
      </div>
    );
  }

  const { proyecto, contratos, movimientos, resumen } = data;

  // Inventario agregado: suma por (material, unidad)
  const invMap = {};
  for (const m of movimientos) {
    const key = `${m.material}__${m.unidad}`;
    if (!invMap[key]) invMap[key] = { material: m.material, unidad: m.unidad, cantidad: 0 };
    invMap[key].cantidad += Number(m.cantidad) || 0;
  }
  const inventario = Object.values(invMap).sort((a, b) =>
    a.material.localeCompare(b.material, 'es')
  );

  const totalGastado = Number(resumen?.total_gastado || 0);
  const presupuesto = Number(resumen?.presupuesto || proyecto.presupuesto || 0);
  const pctEjecutado = presupuesto ? Math.round((totalGastado / presupuesto) * 100) : 0;
  const contratosActivos = contratos.filter((c) => c.estado === 'activo').length;

  return (
    <div className="min-h-full bg-slate-50 pb-10">
      <header className="bg-brand text-white px-4 py-6 shadow">
        <div className="max-w-5xl mx-auto">
          <Link to="/" className="text-xs opacity-70 hover:opacity-100">
            ← Proyectos
          </Link>
          <h1 className="text-2xl font-semibold mt-1">{proyecto.nombre}</h1>
          <div className="text-sm opacity-80 mt-1">
            <span className="capitalize">{proyecto.estado}</span> · Iniciado{' '}
            {formatDate(proyecto.created_at)}
            {proyecto.direccion ? ` · ${proyecto.direccion}` : ''}
          </div>
        </div>
      </header>

      <main className="p-4 space-y-6 max-w-5xl mx-auto">
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card label="Presupuesto" value={formatColones(presupuesto)} />
          <Card label="Gastado" value={formatColones(totalGastado)} />
          <Card
            label="% ejecutado"
            value={`${pctEjecutado}%`}
            tone={pctEjecutado > 90 ? 'red' : pctEjecutado > 70 ? 'amber' : 'green'}
          />
          <Card label="Contratos activos" value={contratosActivos} />
        </section>

        <Section title="Inventario de materiales">
          {inventario.length === 0 ? (
            <p className="text-slate-500 text-sm">Sin movimientos registrados.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-slate-500 border-b">
                  <tr>
                    <th className="py-2 font-medium">Material</th>
                    <th className="font-medium">Unidad</th>
                    <th className="text-right font-medium">Cantidad</th>
                  </tr>
                </thead>
                <tbody>
                  {inventario.map((i) => (
                    <tr
                      key={i.material + i.unidad}
                      className="border-b border-slate-100 last:border-0"
                    >
                      <td className="py-2">{i.material}</td>
                      <td>{i.unidad}</td>
                      <td className="text-right font-medium">{i.cantidad}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section title="Contratistas">
          {contratos.length === 0 ? (
            <p className="text-slate-500 text-sm">No hay contratos registrados.</p>
          ) : (
            <div className="space-y-3">
              {contratos.map((c) => (
                <ContratoRow key={c.contrato_id} c={c} />
              ))}
            </div>
          )}
        </Section>

        <Section title="Últimos movimientos">
          {movimientos.length === 0 ? (
            <p className="text-slate-500 text-sm">Sin movimientos.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-slate-500 border-b">
                  <tr>
                    <th className="py-2 font-medium">Fecha</th>
                    <th className="font-medium">Usuario</th>
                    <th className="font-medium">Material</th>
                    <th className="text-right font-medium">Cantidad</th>
                    <th className="text-right font-medium">Precio</th>
                  </tr>
                </thead>
                <tbody>
                  {movimientos.map((m) => (
                    <tr
                      key={m.id}
                      className="border-b border-slate-100 last:border-0"
                    >
                      <td className="py-2 whitespace-nowrap">{formatDate(m.fecha_compra)}</td>
                      <td className="whitespace-nowrap">{m.usuarios?.nombre || '—'}</td>
                      <td>{m.material}</td>
                      <td className="text-right whitespace-nowrap">
                        {m.cantidad} {m.unidad}
                      </td>
                      <td className="text-right whitespace-nowrap">
                        {formatColones(m.precio_total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </main>
    </div>
  );
}

function Card({ label, value, tone }) {
  const toneCls =
    tone === 'red'
      ? 'text-rose-600'
      : tone === 'amber'
      ? 'text-amber-600'
      : tone === 'green'
      ? 'text-emerald-600'
      : 'text-slate-900';
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
      <div className="text-xs text-slate-500 uppercase tracking-wide">{label}</div>
      <div className={`text-xl font-semibold mt-1 ${toneCls}`}>{value}</div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
      <h2 className="font-semibold text-slate-900 mb-3">{title}</h2>
      {children}
    </section>
  );
}

function ContratoRow({ c }) {
  const vigente = Number(c.monto_vigente || 0);
  const saldo = Number(c.saldo_pendiente || 0);
  const pctPendiente = vigente ? Math.round((saldo / vigente) * 100) : 0;
  const tone =
    pctPendiente > 75
      ? 'bg-rose-50 text-rose-700 border-rose-200'
      : pctPendiente > 25
      ? 'bg-amber-50 text-amber-700 border-amber-200'
      : 'bg-emerald-50 text-emerald-700 border-emerald-200';

  return (
    <div className="border border-slate-200 rounded-lg p-3">
      <div className="flex justify-between items-start gap-2">
        <div>
          <div className="font-medium text-slate-900">{c.contratista_nombre}</div>
          {c.especialidad && (
            <div className="text-xs text-slate-500">{c.especialidad}</div>
          )}
          {c.descripcion && (
            <div className="text-sm text-slate-600 mt-1">{c.descripcion}</div>
          )}
        </div>
        <span className={`text-xs px-2 py-1 rounded border ${tone} whitespace-nowrap`}>
          {pctPendiente}% pendiente
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 text-sm">
        <MiniStat label="Vigente" value={formatColones(c.monto_vigente)} />
        <MiniStat label="Pagado" value={formatColones(c.total_pagado)} />
        <MiniStat label="Saldo" value={formatColones(c.saldo_pendiente)} />
        <MiniStat label="% pagado" value={`${c.porcentaje_pagado || 0}%`} />
      </div>
    </div>
  );
}

function MiniStat({ label, value }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="font-semibold text-slate-800">{value}</div>
    </div>
  );
}
