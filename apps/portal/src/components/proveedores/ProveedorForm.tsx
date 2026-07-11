import { useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import type { Proveedor } from '../../types';

export interface DatosProveedorForm {
  readonly nombre: string;
  readonly cedulaJuridica: string | null;
  readonly categorias: readonly string[];
  readonly notas: string | null;
  readonly activo?: boolean;
}

interface ProveedorFormProps {
  readonly proveedor?: Proveedor | null;
  readonly onGuardar: (datos: DatosProveedorForm) => Promise<unknown>;
  readonly onCancelar?: () => void;
}

export default function ProveedorForm({ proveedor = null, onGuardar, onCancelar }: ProveedorFormProps) {
  const esEdicion = proveedor !== null;
  const [nombre, setNombre] = useState(proveedor?.nombre ?? '');
  const [cedulaJuridica, setCedulaJuridica] = useState(proveedor?.cedulaJuridica ?? '');
  const [categorias, setCategorias] = useState<readonly string[]>(proveedor?.categorias ?? []);
  const [categoriaTexto, setCategoriaTexto] = useState('');
  const [notas, setNotas] = useState(proveedor?.notas ?? '');
  const [activo, setActivo] = useState(proveedor?.activo ?? true);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  function agregarCategoria(): void {
    const valor = categoriaTexto.trim();
    if (valor === '' || categorias.includes(valor)) {
      setCategoriaTexto('');
      return;
    }
    setCategorias([...categorias, valor]);
    setCategoriaTexto('');
  }

  function quitarCategoria(valor: string): void {
    setCategorias(categorias.filter((c) => c !== valor));
  }

  function onKeyDownCategoria(evento: KeyboardEvent<HTMLInputElement>): void {
    if (evento.key === 'Enter' || evento.key === ',') {
      evento.preventDefault();
      agregarCategoria();
    }
  }

  async function onSubmit(evento: FormEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault();
    setError(null);

    if (nombre.trim() === '') {
      setError('El nombre es obligatorio.');
      return;
    }

    const datos: DatosProveedorForm = {
      nombre: nombre.trim(),
      cedulaJuridica: cedulaJuridica.trim() === '' ? null : cedulaJuridica.trim(),
      categorias,
      notas: notas.trim() === '' ? null : notas.trim(),
      ...(esEdicion ? { activo } : {}),
    };

    setEnviando(true);
    try {
      await onGuardar(datos);
      if (!esEdicion) {
        setNombre('');
        setCedulaJuridica('');
        setCategorias([]);
        setNotas('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No pudimos guardar el proveedor.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form className="form-card" onSubmit={onSubmit} aria-label={esEdicion ? 'Editar proveedor' : 'Nuevo proveedor'}>
      <label>
        <span>Nombre</span>
        <input value={nombre} onChange={(evento) => setNombre(evento.target.value)} autoComplete="off" />
      </label>
      <label>
        <span>Cedula juridica</span>
        <input
          value={cedulaJuridica}
          onChange={(evento) => setCedulaJuridica(evento.target.value)}
          placeholder="3-101-..."
          autoComplete="off"
        />
      </label>
      <label>
        <span>Categorias</span>
        <div className="tag-input">
          <div className="tag-list">
            {categorias.map((categoria) => (
              <span className="chip tag" key={categoria}>
                {categoria}
                <button type="button" aria-label={`Quitar ${categoria}`} onClick={() => quitarCategoria(categoria)}>
                  ×
                </button>
              </span>
            ))}
          </div>
          <input
            value={categoriaTexto}
            onChange={(evento) => setCategoriaTexto(evento.target.value)}
            onKeyDown={onKeyDownCategoria}
            onBlur={agregarCategoria}
            placeholder="agrega y presiona Enter"
            autoComplete="off"
          />
        </div>
      </label>
      <label>
        <span>Notas</span>
        <textarea value={notas} onChange={(evento) => setNotas(evento.target.value)} rows={3} />
      </label>
      {esEdicion && (
        <label className="checkbox-label">
          <input type="checkbox" checked={activo} onChange={(evento) => setActivo(evento.target.checked)} />
          <span>Activo</span>
        </label>
      )}
      {error !== null && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="submit" disabled={enviando}>
          {enviando ? 'Guardando...' : esEdicion ? 'Guardar cambios' : 'Crear proveedor'}
        </button>
        {onCancelar !== undefined && (
          <button type="button" className="secondary" onClick={onCancelar}>
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}
