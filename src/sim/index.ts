/** Public sim API. Client and bot code import from here. */

export { createGame } from './sim';
export { serialize, deserialize, deserializeSave, SaveError, SaveVersionError } from './serialize';
export type { ControllerSave, LoadedSave, SaveErrorCode } from './serialize';
export { hashState } from './hash';
export * from './types';
export { replay, CommandRecorder, commandLogToJson, commandLogFromJson } from './replay';
export type { CommandLog, CommandLogEntry, ReplayOptions, ReplayResult } from './replay';
/** Pure functions on a caller-owned RngState (the AI keeps its own stream; it must not touch `state.rng`). */
export { createRng, rngInt, rngRange } from './rng';
