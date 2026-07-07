/**
 * @proveeduria/core — dominio puro del Modulo 1.
 *
 * Sin IO, sin dependencias de runtime, testeado exhaustivamente. Es el codigo que
 * "un agente jamas debe ajustar de paso" (AI_ASSISTED_DEVELOPMENT.md §2). Toda regla
 * de negocio verificable (transiciones, numeracion, permisos, politica de aprobacion,
 * deteccion de excepciones) vive aqui y se importa desde apps/* y packages/agent.
 */

export * from './types.js';
export * from './state-machine.js';
export * from './numbering.js';
export * from './roles.js';
export * from './policy.js';
export * from './exceptions.js';
