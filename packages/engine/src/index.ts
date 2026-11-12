/**
 * @coach/engine — deterministic readiness and training-recommendation engine.
 *
 * Pure functions only: no network, no database, no clock reads, no randomness.
 * Every output can be reproduced from its inputs, which is what lets the AI
 * layer explain a recommendation without being allowed to invent one.
 */
export const ENGINE_VERSION = '0.1.0';

export * from './domain';
export * from './dates';
