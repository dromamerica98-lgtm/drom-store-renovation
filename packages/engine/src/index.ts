/**
 * @coach/engine — deterministic readiness and training-recommendation engine.
 *
 * Pure functions only: no network, no database, no clock reads, no randomness.
 * Every output can be reproduced from its inputs, which is what lets the AI
 * layer explain a recommendation without being allowed to invent one.
 */
export { ENGINE_VERSION } from './version';
export * from './domain';
export * from './dates';
export * from './format';
export * from './baselines';
export * from './zones';
export * from './load';
export * from './readiness';
export * from './workouts';
export * from './decision';
export * from './modify';
export * from './assess';
export { fnv1a } from './stats';
