import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { ROLES_VER_PROVEEDORES, ROLES_VER_REVISIONES, tieneAlgunRol } from '../permisos';
import type { Usuario } from '../types';
import PedidosScreen from './pedidos/PedidosScreen';
import ProveedoresScreen from './proveedores/ProveedoresScreen';
import RevisionesScreen from './revisiones/RevisionesScreen';

type Pantalla = 'pedidos' | 'proveedores' | 'revisiones';

export default function Shell({ usuario }: { usuario: Usuario }) {
  const auth = useAuth();
  const [pantalla, setPantalla] = useState<Pantalla>('pedidos');

  const puedeVerProveedores = tieneAlgunRol(usuario, ROLES_VER_PROVEEDORES);
  const puedeVerRevisiones = tieneAlgunRol(usuario, ROLES_VER_REVISIONES);

  return (
    <div className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Atemporal</p>
          <h1>Centro de Control</h1>
        </div>
        <nav className="shell-nav" aria-label="Navegacion principal">
          <button
            type="button"
            className={pantalla === 'pedidos' ? 'active' : ''}
            onClick={() => setPantalla('pedidos')}
          >
            Pedidos
          </button>
          {puedeVerProveedores && (
            <button
              type="button"
              className={pantalla === 'proveedores' ? 'active' : ''}
              onClick={() => setPantalla('proveedores')}
            >
              Proveedores
            </button>
          )}
          {puedeVerRevisiones && (
            <button
              type="button"
              className={pantalla === 'revisiones' ? 'active' : ''}
              onClick={() => setPantalla('revisiones')}
            >
              Revisiones
            </button>
          )}
        </nav>
        <div className="session">
          <span>
            {usuario.nombre} · {usuario.roles.join(', ')}
          </span>
          <button type="button" onClick={() => void auth.cerrarSesion()}>
            Salir
          </button>
        </div>
      </header>

      <main className="shell-body">
        {pantalla === 'pedidos' && <PedidosScreen usuario={usuario} />}
        {pantalla === 'proveedores' && puedeVerProveedores && <ProveedoresScreen usuario={usuario} />}
        {pantalla === 'revisiones' && puedeVerRevisiones && <RevisionesScreen />}
      </main>
    </div>
  );
}
