// Public API of the dictation feature. The UI consumes DictationSession (never
// the engine directly); engines are chosen here: Expo for the app, Fake in tests.

export type {
  DictationEngine,
  DictationEngineEvents,
  DictationError,
  DictationErrorCode,
  DictationStartOptions,
} from './types';
export { transition } from './sessionMachine';
export type { SessionState, SessionEventType, SessionEffect, Transition } from './sessionMachine';
export { TranscriptComposer } from './voiceCommands';
export type { VoiceCommand } from './voiceCommands';
export { DictationSession } from './DictationSession';
export type { DictationSessionEvent, DictationSessionOptions } from './DictationSession';
export { ExpoDictationEngine } from './engines/ExpoDictationEngine';
export { FakeDictationEngine } from './engines/FakeDictationEngine';
export type { FakeScriptStep } from './engines/FakeDictationEngine';
export { DebouncedSaver } from './autosave';
export type { SaveStatus, DebouncedSaverOptions } from './autosave';
export { runPreflight, createNativePreflightChecks, downloadOfflineModel } from './preflight';
export type {
  PreflightChecks,
  PreflightIssue,
  PreflightIssueId,
  PreflightAction,
  PreflightReport,
} from './preflight';
export { DictationScreen } from './DictationScreen';
export type { DictationScreenProps } from './DictationScreen';
export { MicButton } from './MicButton';
export type { MicVisualState } from './MicButton';
export { OutlineTrack, OUTLINE_TRACK_COLLAPSED_KEY } from './OutlineTrack';
export type { OutlineTrackProps, OutlineTrackRepository } from './OutlineTrack';
export { useDictationController } from './useDictationController';
export type { DictationController, DictationControllerOptions } from './useDictationController';
