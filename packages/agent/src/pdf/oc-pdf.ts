import PDFDocument from 'pdfkit';

/**
 * Generador determinista del PDF de la Orden de Compra (tools.md `emitir_oc` §"PDF de la
 * OC"; outbox-whatsapp.md §Documentos adjuntos). Layout fijo con las fuentes built-in de
 * pdfkit (Helvetica) — sin fuentes ni assets externos, para que el resultado sea
 * reproducible en cualquier entorno de build/CI.
 *
 * Reproducibilidad: pdfkit deriva el `/ID` del PDF (y el `CreationDate`/`ModDate` de los
 * metadatos) de `options.info`; si no se fija explicitamente usa `new Date()` (no
 * determinista). Aqui `info.CreationDate`/`ModDate` se fijan con `datos.fecha` (parametro,
 * NUNCA `new Date()`), asi que para el MISMO input el PDF resultante es byte-identico
 * (verificado en oc-pdf.test.ts). La compresion de streams (zlib) tambien es determinista
 * para el mismo contenido de entrada en un mismo entorno.
 */

const MARGEN = 50;
const ANCHO_PAGINA = 'A4';

export interface DatosPdfOcItem {
  readonly descripcion: string;
  readonly cantidad: number;
  readonly unidad: string;
  readonly precioUnitario: number;
  readonly subtotal: number;
}

export interface DatosPdfOc {
  readonly numeroOc: string;
  /** Fecha de emision de la OC. SIEMPRE recibida por parametro (ctx.ahora), nunca `new Date()`. */
  readonly fecha: Date;
  readonly numeroPedido: string;
  readonly proyecto: { readonly nombre: string; readonly codigo: string };
  readonly proveedor: { readonly nombre: string; readonly cedulaJuridica: string | null };
  readonly items: readonly DatosPdfOcItem[];
  readonly montoTotal: number;
  readonly condiciones: string | null;
  readonly plazoEntrega: string | null;
}

interface Columna {
  readonly titulo: string;
  readonly x: number;
  readonly width: number;
  readonly align: 'left' | 'right';
}

function formatCRC(value: number): string {
  return `CRC ${value.toFixed(2)}`;
}

function formatCantidad(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatFecha(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

function definirColumnas(anchoContenido: number): readonly Columna[] {
  const definicion: readonly { titulo: string; fraccion: number; align: 'left' | 'right' }[] = [
    { titulo: 'Descripcion', fraccion: 0.36, align: 'left' },
    { titulo: 'Cantidad', fraccion: 0.12, align: 'right' },
    { titulo: 'Unidad', fraccion: 0.12, align: 'left' },
    { titulo: 'Precio unit.', fraccion: 0.2, align: 'right' },
    { titulo: 'Subtotal', fraccion: 0.2, align: 'right' },
  ];

  let cursorX = MARGEN;
  const columnas: Columna[] = [];
  for (const { titulo, fraccion, align } of definicion) {
    const width = anchoContenido * fraccion;
    columnas.push({ titulo, x: cursorX, width, align });
    cursorX += width;
  }
  return columnas;
}

/** Dibuja una fila (header o datos) alineando cada celda a la misma `y` de inicio. */
function dibujarFila(
  doc: PDFKit.PDFDocument,
  y: number,
  columnas: readonly Columna[],
  valores: readonly string[],
  opciones: { readonly negrita?: boolean } = {},
): number {
  doc.font(opciones.negrita === true ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);

  let alturaMaxima = 0;
  for (const [index, columna] of columnas.entries()) {
    const texto = valores[index] ?? '';
    const altura = doc.heightOfString(texto, { width: columna.width, align: columna.align });
    if (altura > alturaMaxima) alturaMaxima = altura;
  }

  for (const [index, columna] of columnas.entries()) {
    const texto = valores[index] ?? '';
    doc.text(texto, columna.x, y, { width: columna.width, align: columna.align });
  }

  return y + alturaMaxima + 6;
}

function asegurarEspacio(
  doc: PDFKit.PDFDocument,
  y: number,
  alturaRequerida: number,
  columnas: readonly Columna[],
): number {
  const limite = doc.page.height - doc.page.margins.bottom;
  if (y + alturaRequerida <= limite) return y;

  doc.addPage();
  let nuevaY = MARGEN;
  nuevaY = dibujarFila(doc, nuevaY, columnas, columnas.map((c) => c.titulo), { negrita: true });
  doc.moveTo(MARGEN, nuevaY - 2)
    .lineTo(MARGEN + columnas.reduce((acc, c) => acc + c.width, 0), nuevaY - 2)
    .lineWidth(0.5)
    .strokeColor('#333333')
    .stroke();
  return nuevaY + 4;
}

function dibujarOc(doc: PDFKit.PDFDocument, datos: DatosPdfOc): void {
  const anchoContenido = doc.page.width - MARGEN * 2;
  const columnas = definirColumnas(anchoContenido);

  doc.font('Helvetica-Bold').fontSize(18).text('Atemporal', MARGEN, MARGEN);
  doc.font('Helvetica-Bold').fontSize(14).text(`Orden de Compra ${datos.numeroOc}`, MARGEN, doc.y + 2);
  doc.font('Helvetica').fontSize(10).text(`Fecha: ${formatFecha(datos.fecha)}`, MARGEN, doc.y + 4);

  doc.moveDown(0.75);
  doc.font('Helvetica-Bold').fontSize(10).text('Proyecto:', MARGEN, doc.y, { continued: true });
  doc.font('Helvetica').text(` ${datos.proyecto.nombre} (${datos.proyecto.codigo})`);

  doc.font('Helvetica-Bold').text('Proveedor:', MARGEN, doc.y + 2, { continued: true });
  const cedula = datos.proveedor.cedulaJuridica ?? 'N/D';
  doc.font('Helvetica').text(` ${datos.proveedor.nombre} - Cedula juridica: ${cedula}`);

  doc.font('Helvetica-Bold').text('Referencia:', MARGEN, doc.y + 2, { continued: true });
  doc.font('Helvetica').text(` Pedido ${datos.numeroPedido}`);

  doc.moveDown(1);

  let y = dibujarFila(doc, doc.y, columnas, columnas.map((c) => c.titulo), { negrita: true });
  doc.moveTo(MARGEN, y - 2)
    .lineTo(MARGEN + anchoContenido, y - 2)
    .lineWidth(0.5)
    .strokeColor('#333333')
    .stroke();
  y += 4;

  for (const item of datos.items) {
    const valores = [
      item.descripcion,
      formatCantidad(item.cantidad),
      item.unidad,
      formatCRC(item.precioUnitario),
      formatCRC(item.subtotal),
    ];
    const alturaEstimativa = Math.max(
      ...columnas.map((columna, index) => (
        doc.heightOfString(valores[index] ?? '', { width: columna.width, align: columna.align })
      )),
    ) + 6;
    y = asegurarEspacio(doc, y, alturaEstimativa, columnas);
    y = dibujarFila(doc, y, columnas, valores);
  }

  y += 4;
  doc.moveTo(MARGEN, y).lineTo(MARGEN + anchoContenido, y).lineWidth(0.5).strokeColor('#333333').stroke();
  y += 8;

  y = asegurarEspacio(doc, y, 20, columnas);
  doc.font('Helvetica-Bold').fontSize(11).text(
    `Total: ${formatCRC(datos.montoTotal)}`,
    MARGEN,
    y,
    { width: anchoContenido, align: 'right' },
  );
  y = doc.y + 12;

  y = asegurarEspacio(doc, y, 40, columnas);
  doc.font('Helvetica-Bold').fontSize(10).text('Condiciones:', MARGEN, y, { continued: true });
  doc.font('Helvetica').text(` ${datos.condiciones ?? 'N/D'}`, { width: anchoContenido });

  doc.font('Helvetica-Bold').text('Plazo de entrega:', MARGEN, doc.y + 2, { continued: true });
  doc.font('Helvetica').text(` ${datos.plazoEntrega ?? 'N/D'}`, { width: anchoContenido });
}

export async function generarPdfOc(datos: DatosPdfOc): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: ANCHO_PAGINA,
        margin: MARGEN,
        autoFirstPage: true,
        // Fija los metadatos (y por tanto el /ID derivado de ellos) con `datos.fecha` para
        // que la generacion sea reproducible byte a byte con el mismo input.
        info: {
          Title: `Orden de Compra ${datos.numeroOc}`,
          Author: 'Atemporal',
          Producer: 'Proveeduria Atemporal',
          Creator: 'Proveeduria Atemporal',
          CreationDate: datos.fecha,
          ModDate: datos.fecha,
        },
      });

      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', (error: Error) => reject(error));

      dibujarOc(doc, datos);

      doc.end();
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
