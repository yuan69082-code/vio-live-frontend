import { ApplicationError } from '../../core/errors.js';

export class FirstRoundTransportUnavailableError extends ApplicationError {
  constructor() {
    super('First-round continuity transport is not configured.', {
      code: 'continuity_transport_unconfigured',
      statusCode: 503,
    });
  }
}

export function createUnconfiguredFirstRoundTransport() {
  return Object.freeze({
    mode: 'unconfigured',
    testOnly: false,
    submit() {
      throw new FirstRoundTransportUnavailableError();
    },
  });
}
