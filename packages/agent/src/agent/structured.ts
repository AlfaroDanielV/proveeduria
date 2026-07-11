import { TOOLS_REGISTRY } from './registry.js';
import type { ToolCallEstructurado, ToolFase2a } from './types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whitelist de nombres derivada del registro unico (registry.ts) — sin lista duplicada. */
const NOMBRES_FASE_2A: ReadonlySet<string> = new Set(TOOLS_REGISTRY.map((t) => t.name));

export function esToolFase2a(name: string): name is ToolFase2a {
  return NOMBRES_FASE_2A.has(name);
}

function textoDePayload(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  if (typeof payload.text === 'string') return payload.text;
  if (isRecord(payload.text) && typeof payload.text.body === 'string') {
    return payload.text.body;
  }
  if (typeof payload.body === 'string') return payload.body;
  if (typeof payload.caption === 'string') return payload.caption;
  return null;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function extraerDesdeRecord(record: Record<string, unknown>): ToolCallEstructurado | null {
  const raw = isRecord(record.tool_call)
    ? record.tool_call
    : isRecord(record.toolCall)
      ? record.toolCall
      : record;

  if (typeof raw.name !== 'string' || !esToolFase2a(raw.name)) {
    return null;
  }

  return {
    name: raw.name,
    input: raw.input,
  };
}

export function extraerToolCallEstructurado(payload: unknown): ToolCallEstructurado | null {
  if (isRecord(payload)) {
    const direct = extraerDesdeRecord(payload);
    if (direct !== null) return direct;

    const text = textoDePayload(payload);
    if (text !== null) {
      const fromText = parseJsonObject(text.trim());
      return fromText === null ? null : extraerDesdeRecord(fromText);
    }
  }

  if (typeof payload === 'string') {
    const fromText = parseJsonObject(payload.trim());
    return fromText === null ? null : extraerDesdeRecord(fromText);
  }

  return null;
}
