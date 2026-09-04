import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { ValidationError } from '../../core/errors.js';

export const randomToken = () => randomBytes(32).toString('base64url');
export const digest = (value) => createHash('sha256').update(value).digest('hex');
export function passwordKey(value, salt) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 256) {
    throw new ValidationError('Passphrase must contain 12–256 characters.',{field:'passphrase'});
  }
  return scryptSync(value, Buffer.from(salt,'base64url'), 32, {N:32768,r:8,p:1,maxmem:64*1024*1024});
}
export function equalSecret(a,b) {
  const x=Buffer.from(a); const y=Buffer.from(b);
  return x.length===y.length && timingSafeEqual(x,y);
}
export function encrypt(key, plaintext, associatedData) {
  const iv=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(Buffer.from(associatedData));
  const data=Buffer.concat([cipher.update(plaintext),cipher.final()]);
  return [iv,data,cipher.getAuthTag()].map(x=>x.toString('base64url')).join('.');
}
export function decrypt(key,value,associatedData) {
  const [iv,data,tag]=value.split('.').map(x=>Buffer.from(x,'base64url'));
  const cipher=createDecipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(Buffer.from(associatedData)); cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(data),cipher.final()]);
}
