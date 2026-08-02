export function createFirstRoundFixtureTransport(handler) {
  if (typeof handler !== 'function') {
    throw new TypeError('First-round fixture transport requires a handler function.');
  }
  const receivedRequests = [];
  return Object.freeze({
    mode: 'fixture',
    testOnly: true,
    receivedRequests,
    get callCount() {
      return receivedRequests.length;
    },
    submit(storedLogicalRequest) {
      const request = structuredClone(storedLogicalRequest);
      receivedRequests.push(request);
      return structuredClone(handler(request, receivedRequests.length));
    },
  });
}
