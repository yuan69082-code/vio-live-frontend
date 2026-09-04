import { afterEach, describe, expect, it, vi } from 'vitest'
import { sealCredential } from './seal-credential'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
describe('transient credential transport', () => {
  it('round trips a long test credential through RSA-OAEP + AES-GCM, without browser storage', async () => {
    const storage = vi.spyOn(Storage.prototype, 'setItem')
    const pair = await crypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['encrypt', 'decrypt'])
    const encode = (value: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(value)))
    const decode = (value: string) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0))
    const publicKey = encode(await crypto.subtle.exportKey('spki', pair.publicKey))
    const transport = { keyId: 'test-transport', algorithm: 'RSA-OAEP-256+A256GCM' as const, publicKeySpki: publicKey }
    const fixture = `not-a-real-credential-${'fixture'.repeat(200)}`
    const sealed = await sealCredential(fixture, transport)
    expect(JSON.stringify(sealed)).not.toContain(fixture)
    const rawKey = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, pair.privateKey, decode(sealed.sealedCredential.encryptedKey))
    const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt'])
    const options = { name: 'AES-GCM', iv: decode(sealed.sealedCredential.iv), additionalData: new TextEncoder().encode(transport.keyId) }
    const plain = await crypto.subtle.decrypt(options, key, decode(sealed.sealedCredential.ciphertext))
    expect(new TextDecoder().decode(plain)).toBe(fixture)
    await expect(crypto.subtle.decrypt({ ...options, additionalData: new TextEncoder().encode('wrong-id') }, key, decode(sealed.sealedCredential.ciphertext))).rejects.toThrow()
    expect(storage).not.toHaveBeenCalled()
  })
})
