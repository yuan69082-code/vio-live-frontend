import type { Vault } from './personal-api'

function base64(bytes: Uint8Array) {
  let text = ''
  bytes.forEach((byte) => { text += String.fromCharCode(byte) })
  return btoa(text)
}

/** Transient hybrid encryption; no persistence, logging, or URL transport. */
export async function sealCredential(credential: string, transport: Vault['transport']) {
  if (transport.algorithm !== 'RSA-OAEP-256+A256GCM') throw new Error('Unsupported credential transport')
  const spki = Uint8Array.from(atob(transport.publicKeySpki), (character) => character.charCodeAt(0))
  const publicKey = await crypto.subtle.importKey('spki', spki, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt'])
  const keyBytes = crypto.getRandomValues(new Uint8Array(32))
  const plainBytes = new TextEncoder().encode(credential)
  try {
    const aes = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt'])
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(transport.keyId) }, aes, plainBytes)
    const encryptedKey = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, keyBytes)
    return { keyId: transport.keyId, sealedCredential: { encryptedKey: base64(new Uint8Array(encryptedKey)), iv: base64(iv), ciphertext: base64(new Uint8Array(ciphertext)) } }
  } finally { keyBytes.fill(0); plainBytes.fill(0) }
}
