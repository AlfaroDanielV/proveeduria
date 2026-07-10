# Diagramas de flujo

Diagramas del sistema WhatsApp de proveeduría de la empresa constructora. Renderizan en
GitHub / VS Code (Mermaid). Dos vistas:

1. **Prototipo legado** (`server.js`) — lo que está **vivo hoy**, ya con el endurecimiento
   de seguridad aplicado (verificación de firma, gate de remitente, gate de usuario interno).
2. **Sistema objetivo (Módulo 1)** — la arquitectura hacia la que va el producto nuevo
   (`apps/*` + `packages/*`), aún no desplegada.

> Los nodos en **amarillo** son los controles de seguridad agregados en el endurecimiento
> del prototipo (ver `docs/PILOT_VALIDATION_COOKBOOK.md §2.2`).

---

## 1. Prototipo legado — arquitectura y flujo (estado actual, endurecido)

```mermaid
flowchart TD
    U["Usuario interno<br/>(WhatsApp)"] -->|texto / voz / foto| META["Meta WhatsApp<br/>Cloud API"]
    META -->|"POST /webhook"| WH["Azure Web App<br/>server.js"]

    WH --> SIG{"¿Firma HMAC válida?<br/>X-Hub-Signature-256"}
    SIG -->|"no (con secreto puesto)"| R401["401 · rechazado"]
    SIG -->|"sí / secreto sin configurar"| ACK["200 OK a Meta"]

    ACK --> TYPE{"Tipo de mensaje"}
    TYPE -->|texto| GATE
    TYPE -->|"imagen / PDF"| DL["Descarga media de Meta<br/>+ sube a Supabase Storage"]
    TYPE -->|audio| VOZ["Descarga audio<br/>+ Whisper (OpenAI)"]

    DL --> VISION["Claude Vision<br/>(imagen/PDF inline)"]
    VISION --> GATE
    VOZ --> GATE

    GATE{"¿Remitente en tabla 'usuarios'?"}
    GATE -->|no| DENY["Respuesta genérica<br/>(no ejecuta tools)"]
    GATE -->|sí| CLAUDE

    subgraph LOOP["Loop agéntico · askClaude (máx. 10 vueltas)"]
      CLAUDE["Claude Sonnet<br/>SYSTEM_PROMPT + TOOLS"] -->|tool_use| HT["handleTool"]
      HT --> GROL{"Gate rol / usuario interno"}
      GROL -->|autorizado| DB[("Supabase<br/>Postgres + Storage")]
      GROL -->|denegado| HT
      DB --> HT
      HT -->|tool_result| CLAUDE
    end

    CLAUDE -->|"end_turn (texto)"| OUT["sendWhatsAppMessage<br/>(chunks de 4096)"]
    OUT --> META
    DENY --> OUT

    CRON["Cron 17:00 CR<br/>sendDailySummary"] --> DB
    CRON --> OUT

    classDef nuevo fill:#fde68a,stroke:#b45309,color:#111827;
    class SIG,GATE,GROL nuevo;
```

**Notas del prototipo legado:**
- Un solo proceso, un solo archivo (`server.js`), sin cola ni worker.
- Responde `200 OK` y **procesa de forma asíncrona** (fire-and-forget).
- Estado de conversación en un `Map` **en memoria** (se pierde al reiniciar).
- Envíos sin reintento; el cron corre dentro del mismo proceso web.
- **Solo flujo interno**: registrar materiales, escanear facturas, pagos a contratistas,
  dashboards. **No hay flujo de proveedor.**

---

## 2. Prototipo legado — secuencia de un mensaje de texto

```mermaid
sequenceDiagram
    actor U as Usuario interno
    participant M as Meta Cloud API
    participant S as server.js (Azure)
    participant C as Claude (Sonnet)
    participant DB as Supabase

    U->>M: "compré 10 bolsas de cemento para López"
    M->>S: POST /webhook (+ X-Hub-Signature-256)
    S->>S: verifyMetaSignature(rawBody) ✔
    S-->>M: 200 OK
    S->>DB: lookupUsuario(telefono)

    alt Remitente desconocido
        S-->>M: mensaje genérico
        M-->>U: "Este número es solo para el equipo interno"
    else Remitente interno
        loop Hasta end_turn (máx. 10)
            S->>C: messages + SYSTEM_PROMPT + TOOLS
            C-->>S: tool_use: registrar_movimiento
            S->>S: Gate rol / usuario interno ✔
            S->>DB: INSERT movimiento
            DB-->>S: ok
            S->>C: tool_result
        end
        C-->>S: texto final ("Registrado ✅")
        S->>M: sendWhatsAppMessage(texto)
        M-->>U: "Listo, registré 10 bolsas de cemento ✅"
    end
```

---

## 3. Prototipo legado — secuencia de una foto de factura

```mermaid
sequenceDiagram
    actor U as Usuario interno
    participant M as Meta Cloud API
    participant S as server.js
    participant ST as Supabase Storage
    participant C as Claude Vision
    participant DB as Supabase Postgres

    U->>M: envía foto de factura
    M->>S: POST /webhook (type=image)
    S-->>M: 200 OK
    S->>M: descarga media (media_id + token)
    M-->>S: bytes de la imagen
    S->>ST: sube imagen (signed URL)
    S->>C: imagen inline + instrucciones
    C-->>S: tool_use: registrar_factura_escaneada (ítems extraídos)
    S->>DB: INSERT factura (estado=pendiente)
    C-->>S: "Revisá estos datos, ¿confirmo?"
    S->>M: pide confirmación
    M-->>U: datos extraídos
    U->>M: "sí, confirmá"
    M->>S: POST /webhook
    S->>C: (loop) tool_use: confirmar_factura
    S->>DB: INSERT movimientos (uno por ítem) + factura=confirmada
    S->>M: "Registré N movimientos ✅"
    M-->>U: confirmación
```

---

## 4. Sistema objetivo (Módulo 1) — arquitectura hacia la que va el producto

> Aún **no desplegado**. Separa ingesta segura, procesamiento y envío en piezas distintas,
> con auditoría append-only y outbox con reintentos. Incluye el **flujo de proveedor**
> (RFQ → cotización → comparativo) que el legado no tiene.

```mermaid
flowchart TD
    U["Usuario interno / Proveedor<br/>(WhatsApp)"] --> META["Meta Cloud API"]
    META -->|"POST /webhook"| API["apps/api<br/>(ingesta)"]

    API --> V{"Firma válida?"}
    V -->|no| X["401"]
    V -->|sí| PERSIST["INSERT inbound_messages<br/>(dedup por wamid)"]
    PERSIST --> Q[["Cola durable<br/>(broker)"]]
    PERSIST --> ACK200["200 OK"]

    Q --> W["apps/worker<br/>(motor de dominio)"]
    W --> ROUTER{"Resolver remitente"}
    ROUTER -->|interno| CTX["Ctx + Claude loop"]
    ROUTER -->|proveedor| CTXP["Ctx proveedor + Claude loop"]
    ROUTER -->|desconocido| E11["E11 · respuesta genérica"]

    CTX --> TOOLS["Tools deterministas<br/>(crearPedido, enviarRfq,<br/>registrarCotizacion, generarComparativo)"]
    CTXP --> TOOLS
    TOOLS -->|"1 transacción"| PG[("Postgres<br/>dominio + audit + outbox")]

    PG --> DISP["Outbox dispatcher<br/>(reintentos, wamid_salida)"]
    DISP -->|"POST"| META
    META --> U

    PG --> PORTAL["apps/portal<br/>(visor autenticado)"]

    classDef falta fill:#e5e7eb,stroke:#6b7280,color:#374151,stroke-dasharray: 4 3;
    class Q,DISP,CTX,CTXP falta;
```

**Nodos punteados**: piezas que existen como diseño/librería pero **aún no están cableadas**
en un proceso corriendo (broker real, sender real de Meta, adaptador de Claude, extractores).
Ver `docs/PILOT_VALIDATION_COOKBOOK.md §6` y `docs/handoff/FASE2A-current-status.md`.

---

## Leyenda

| Elemento | Significado |
|---|---|
| 🟨 Amarillo (legado) | Control de seguridad agregado en el endurecimiento del prototipo |
| ⬜ Punteado (objetivo) | Pieza del sistema nuevo aún no cableada en runtime |
| `(...)` | Nombre de función/archivo real en el código |
