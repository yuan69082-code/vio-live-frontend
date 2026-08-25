import { ValidationError } from '../../core/errors.js';
import { SUBJECT_RUNTIME_CONNECTION_STATES } from './subject-runtime-port-v1.js';

export const SUBJECT_RUNTIME_CONNECTION_EVENTS = Object.freeze([
  'connect_requested',
  'handshake_succeeded',
  'runtime_degraded',
  'compatibility_failed',
  'runtime_disconnected',
  'pause_requested',
  'resume_requested',
  'reconnect_requested',
  'reconnect_succeeded',
  'reconnect_failed',
  'compatibility_restored',
]);

const transitions = Object.freeze({
  disconnected: Object.freeze({
    connect_requested: 'connecting',
    reconnect_requested: 'reconnecting',
    pause_requested: 'paused',
  }),
  connecting: Object.freeze({
    handshake_succeeded: 'ready',
    runtime_degraded: 'degraded',
    compatibility_failed: 'incompatible',
    runtime_disconnected: 'disconnected',
    pause_requested: 'paused',
  }),
  ready: Object.freeze({
    runtime_degraded: 'degraded',
    compatibility_failed: 'incompatible',
    runtime_disconnected: 'disconnected',
    pause_requested: 'paused',
  }),
  degraded: Object.freeze({
    handshake_succeeded: 'ready',
    reconnect_requested: 'reconnecting',
    compatibility_failed: 'incompatible',
    runtime_disconnected: 'disconnected',
    pause_requested: 'paused',
  }),
  incompatible: Object.freeze({
    compatibility_restored: 'connecting',
    runtime_disconnected: 'disconnected',
    pause_requested: 'paused',
  }),
  paused: Object.freeze({
    resume_requested: 'connecting',
    runtime_disconnected: 'disconnected',
  }),
  reconnecting: Object.freeze({
    reconnect_succeeded: 'ready',
    reconnect_failed: 'degraded',
    compatibility_failed: 'incompatible',
    runtime_disconnected: 'disconnected',
    pause_requested: 'paused',
  }),
});

export const SUBJECT_RUNTIME_CONNECTION_TRANSITIONS = Object.freeze(
  Object.entries(transitions).flatMap(([from, eventMap]) => (
    Object.entries(eventMap).map(([event, to]) => Object.freeze({ from, event, to }))
  )),
);

function requireState(value, field) {
  if (!SUBJECT_RUNTIME_CONNECTION_STATES.includes(value)) {
    throw new ValidationError(`${field} is not a Subject Runtime Port v1 connection state.`, {
      field,
      allowedValues: SUBJECT_RUNTIME_CONNECTION_STATES,
    });
  }
  return value;
}

export function canTransitionSubjectRuntimeConnection(from, event, to) {
  if (!SUBJECT_RUNTIME_CONNECTION_STATES.includes(from)) return false;
  if (!SUBJECT_RUNTIME_CONNECTION_EVENTS.includes(event)) return false;
  return transitions[from]?.[event] === to;
}

export function transitionSubjectRuntimeConnection({ from, event }) {
  requireState(from, 'from');
  if (!SUBJECT_RUNTIME_CONNECTION_EVENTS.includes(event)) {
    throw new ValidationError('event is not a Subject Runtime Port v1 connection event.', {
      field: 'event',
      allowedValues: SUBJECT_RUNTIME_CONNECTION_EVENTS,
    });
  }
  const to = transitions[from]?.[event];
  if (!to) {
    throw new ValidationError(`Connection event ${event} is invalid from ${from}.`, {
      field: 'event',
      code: 'SUBJECT_RUNTIME_INVALID_TRANSITION',
      from,
      event,
    });
  }
  return Object.freeze({ from, event, to });
}
