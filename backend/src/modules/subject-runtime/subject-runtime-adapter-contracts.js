import {
  CAPABILITY_CONTRACT_VERSION,
  CAPABILITY_REQUEST_SCHEMA_VERSION,
  CAPABILITY_RESULT_SCHEMA_VERSION,
} from '../continuity-integration/capability-contract.js';
import { CONTRACT_VERSION as CONTINUITY_INTEGRATION_CONTRACT_VERSION } from '../continuity-integration/first-round-contract.js';
import {
  SUBJECT_RUNTIME_PORT_VERSION,
  validateSubjectRuntimeAdapterManifest,
} from './subject-runtime-port-v1.js';

export const CONTINUITY_ENGINE_ADAPTER_CONTRACT = Object.freeze({
  adapterId: 'continuity-engine',
  adapterKind: 'continuity_engine',
  adapterRole: 'optional',
  coreContract: false,
  subjectRuntimePortVersion: SUBJECT_RUNTIME_PORT_VERSION,
  portIntegrationStatus: 'registered_not_wired',
  specializedContracts: Object.freeze([
    Object.freeze({
      contractId: 'ContinuityInteractionRequest/FirstRoundSuccessResult',
      contractVersion: CONTINUITY_INTEGRATION_CONTRACT_VERSION,
      scope: 'adapter_only',
      status: 'existing',
    }),
    Object.freeze({
      contractId: 'CapabilityRequest',
      contractVersion: CAPABILITY_REQUEST_SCHEMA_VERSION,
      scope: 'adapter_only',
      status: 'existing',
    }),
    Object.freeze({
      contractId: 'CapabilityResult',
      contractVersion: CAPABILITY_RESULT_SCHEMA_VERSION,
      scope: 'adapter_only',
      status: 'existing',
    }),
    Object.freeze({
      contractId: 'continuity-capability-envelope',
      contractVersion: CAPABILITY_CONTRACT_VERSION,
      scope: 'adapter_only',
      status: 'existing',
    }),
    Object.freeze({
      contractId: 'model.generate',
      contractVersion: CAPABILITY_CONTRACT_VERSION,
      scope: 'adapter_only',
      status: 'existing',
    }),
    Object.freeze({
      contractId: 'conversation_response',
      contractVersion: CAPABILITY_CONTRACT_VERSION,
      scope: 'adapter_only',
      status: 'existing',
    }),
  ]),
});

export function defineThirdPartySubjectRuntimeAdapter({
  adapterId,
  adapterVersion,
  runtimeName,
  runtimeVersion = null,
  supportedPortVersions = [SUBJECT_RUNTIME_PORT_VERSION],
  capabilities,
  specializedContracts = [],
}) {
  return validateSubjectRuntimeAdapterManifest({
    portVersion: SUBJECT_RUNTIME_PORT_VERSION,
    adapterId,
    adapterKind: 'third_party',
    adapterVersion,
    runtimeMode: 'external',
    runtimeName,
    runtimeVersion,
    supportedPortVersions,
    capabilities,
    specializedContracts,
  });
}
