import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { formatColones, formatDate } from '../utils/format';

export default function GlobalView() {
  const [proyectos, setProyectos] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('resumen_gastos_proyecto')
        .select('*');
      if (error) setError(error.message);
      else setProyectos(data || []);
    })();
  }, []);

  if (error) {
    return (
      <div className="min-h-full p-6 text-center text-rose-600 bg-slate-50">
        Error cargando proyectos: {error}
      </div>
    );
  }

  return (
    <div className="min-h-full bg-slate-50">
      <header className="bg-brand text-white px-4 py-6 shadow">
        <div className="max-w-5xl mx-auto">
          <h1 className="text-2xl font-semibold">Proveeduría</h1>
          <p className="text-sm opacity-80">Proyectos activos</p>
        </div>
      </header>
      <main className="p-4 max-w-5xl mx-auto">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {proyectos === null && <Skeleton />}
          {proyectos && proyectos.length === 0 && (
            <p className="text-slate-500">No hay proyectos activos.</p>
          )}
          {proyectos &&
            proyectos.map((p) => (
              <Link
                key={p.proyecto_id}
                to={`/proyecto/${p.proyecto_id}`}
                className="bg-white rounded-xl shadow-sm hover:shadow-md transition p-4 border border-slate-200 block"
              >
                <h2 className="font-semibold text-slate-900 text-lg">{p.proyecto}</h2>
                <ExecBar gastado={p.total_gastado} presupuesto={p.presupuesto} />
                <dl className="text-sm text-slate-600 mt-3 space-y-1">
                  <Row k="Presupuesto" v={formatColones(p.presupuesto)} />
                  <Row k="Gastado" v={formatColones(p.total_gastado)} />
                  <Row k="Movimientos" v={p.total_movimientos ?? 0} />
                  <Row k="Última compra" v={formatDate(p.ultima_compra)} />
                </dl>
              </Link>
            ))}
        </div>
      </main>
    </div>
  );
}

function Row({ k, v }) {
  return (
    <div className="flex justify-between">
      <dt className="text-slate-500">{k}</dt>
      <dd className="font-medium text-slate-800">{v}</dd>
    </div>
  );
}

function ExecBar({ gastado, presupuesto }) {
  if (!presupuesto) return null;
  const pct = Math.min(100, Math.round((Number(gastado || 0) / Number(presupuesto)) * 100));
  const color = pct < 70 ? 'bg-emerald-500' : pct < 90 ? 'bg-amber-500' : 'bg-rose-500';
  return (
    <div className="mt-3">
      <div className="flex justify-between text-xs text-slate-500 mb-1">
        <span>{pct}% ejecutado</span>
      </div>
      <div className="w-full bg-slate-100 rounded h-2">
        <div className={`${color} h-2 rounded`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <>
      {[1, 2, 3].map((i) => (
        <div key={i} className="bg-white rounded-xl shadow-sm p-4 h-40 animate-pulse border border-slate-200" />
      ))}
    </>
  );
}
