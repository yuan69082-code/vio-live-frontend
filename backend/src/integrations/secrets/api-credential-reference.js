import { requireApiKeySecretRef } from './environment-api-credential-store.js';
import { VAULT_REF_PATTERN } from './personal-credential-vault.js';

export function requireApiCredentialReference(value) {
  if(typeof value==='string'&&VAULT_REF_PATTERN.test(value)) return {secretRef:value};
  return requireApiKeySecretRef(value);
}
