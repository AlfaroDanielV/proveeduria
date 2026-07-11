import { describe, expect, it } from 'vitest';

import { generarPdfOc } from './oc-pdf.js';
import type { DatosPdfOc } from './oc-pdf.js';

const DATOS_BASE: DatosPdfOc = {
  numeroOc: 'OC-2026-001',
  fecha: new Date('2026-07-10T15:00:00.000Z'),
  numeroPedido: 'PED-2026-001',
  proyecto: { nombre: 'Residencial Lopez', codigo: 'LOP' },
  proveedor: { nombre: 'Rodex', cedulaJuridica: '3-101-111111' },
  items: [
    {
      descripcion: 'Cemento gris',
      cantidad: 10,
      unidad: 'saco',
      precioUnitario: 4500,
      subtotal: 45000,
    },
    {
      descripcion: 'Varilla #4',
      cantidad: 25,
      unidad: 'unidad',
      precioUnitario: 1250,
      subtotal: 31250,
    },
  ],
  montoTotal: 76250,
  condiciones: 'Contado',
  plazoEntrega: '2 dias',
};

describe('generarPdfOc', () => {
  it('produce un buffer que empieza con la cabecera %PDF y tiene tamano razonable', async () => {
    const buffer = await generarPdfOc(DATOS_BASE);

    expect(buffer.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(buffer.length).toBeGreaterThan(500);
    expect(buffer.length).toBeLessThan(50_000);
  });

  it('es reproducible: mismo input -> mismo buffer byte a byte', async () => {
    const bufferA = await generarPdfOc(DATOS_BASE);
    const bufferB = await generarPdfOc(DATOS_BASE);

    expect(bufferA.length).toBe(bufferB.length);
    expect(Buffer.compare(bufferA, bufferB)).toBe(0);
  });

  it('cambia el contenido si cambia el input (no es un buffer estatico ignorando datos)', async () => {
    const bufferBase = await generarPdfOc(DATOS_BASE);
    const bufferOtroTotal = await generarPdfOc({ ...DATOS_BASE, montoTotal: 999_999 });

    expect(Buffer.compare(bufferBase, bufferOtroTotal)).not.toBe(0);
  });

  it('soporta proveedor sin cedula juridica y sin condiciones/plazo (N/D)', async () => {
    const buffer = await generarPdfOc({
      ...DATOS_BASE,
      proveedor: { nombre: 'Proveedor sin cedula', cedulaJuridica: null },
      condiciones: null,
      plazoEntrega: null,
    });

    expect(buffer.subarray(0, 4).toString('latin1')).toBe('%PDF');
  });

  it('soporta muchos items sin fallar (pagina adicional)', async () => {
    const muchosItems = Array.from({ length: 60 }, (_, index) => ({
      descripcion: `Item de prueba numero ${index + 1} con descripcion mas larga para forzar wrap`,
      cantidad: index + 1,
      unidad: 'unidad',
      precioUnitario: 100 + index,
      subtotal: (index + 1) * (100 + index),
    }));

    const buffer = await generarPdfOc({
      ...DATOS_BASE,
      items: muchosItems,
      montoTotal: muchosItems.reduce((acc, item) => acc + item.subtotal, 0),
    });

    expect(buffer.subarray(0, 4).toString('latin1')).toBe('%PDF');
  });
});
