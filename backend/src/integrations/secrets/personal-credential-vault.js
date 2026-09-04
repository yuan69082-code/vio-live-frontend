import { constants, generateKeyPairSync, privateDecrypt, randomUUID, createDecipheriv } from 'node:crypto';
import { ApplicationError, ValidationError } from '../../core/errors.js';
import { encrypt, decrypt } from '../../modules/personal/personal-crypto.js';
import { fields } from '../../modules/personal/personal-validation.js';

export const VAULT_REF_PATTERN = /^vault:([0-9a-f-]{36})$/;
export function createPersonalCredentialVault({repository}) {
  const unlocked=new Map(); let transport=null;
  const locked=()=>new ApplicationError('Personal credential vault is locked.',{code:'VAULT_LOCKED',statusCode:423});
  function key(user) {
    if(repository.identity(user)?.status!=='active')throw new ApplicationError('Personal credential use is suspended.',{code:'CREDENTIAL_UNAVAILABLE',statusCode:409});
    const value=unlocked.get(user); if(!value) throw locked(); return value;
  }
  function transportKeys() {
    if(!transport) transport={keyId:randomUUID(),...generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'der'},privateKeyEncoding:{type:'pkcs8',format:'pem'}})};
    return transport;
  }
  return {
    unlock(user,value) {unlocked.get(user)?.fill(0);unlocked.set(user,value);},
    lock(user) {unlocked.get(user)?.fill(0);unlocked.delete(user);},
    close() {for(const k of unlocked.values()) k.fill(0);unlocked.clear();transport=null;},
    status:user=>unlocked.has(user)?'ready':'locked',
    publicTransport(user) {
      key(user); const t=transportKeys();
      return {status:'ready',transport:{keyId:t.keyId,algorithm:'RSA-OAEP-256+A256GCM',publicKeySpki:t.publicKey.toString('base64')}};
    },
    unseal(user,keyId,value) {
      key(user); const t=transportKeys();
      fields(value,['encryptedKey','iv','ciphertext'],['encryptedKey','iv','ciphertext']);
      if(keyId!==t.keyId) throw new ApplicationError('Encryption transport key changed; re-enter the credential.',{code:'TRANSPORT_KEY_CHANGED',statusCode:409});
      for(const field of ['encryptedKey','iv','ciphertext']) {
        if(typeof value[field]!=='string'||value[field].length>12000||!/^[A-Za-z0-9+/]+={0,2}$/.test(value[field])) throw new ValidationError('Invalid encrypted credential.',{field:'sealedCredential'});
      }
      let secretKey; let plaintext;
      try {
        secretKey=privateDecrypt({key:t.privateKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(value.encryptedKey,'base64'));
        const data=Buffer.from(value.ciphertext,'base64'); const iv=Buffer.from(value.iv,'base64');
        if(secretKey.length!==32||iv.length!==12||data.length<17||data.length>8208) throw new Error('invalid encrypted payload');
        const decipher=createDecipheriv('aes-256-gcm',secretKey,iv);
        decipher.setAAD(Buffer.from(keyId)); decipher.setAuthTag(data.subarray(-16));
        plaintext=Buffer.concat([decipher.update(data.subarray(0,-16)),decipher.final()]);
        const credential=new TextDecoder('utf-8',{fatal:true}).decode(plaintext);
        if(!credential.length || credential.length>8192 || /[\s\u0000-\u001f\u007f]/u.test(credential)) throw new Error('invalid credential');
        return Buffer.from(plaintext);
      } catch {throw new ValidationError('Encrypted credential could not be validated.',{field:'sealedCredential'});}
      finally {secretKey?.fill(0);plaintext?.fill(0);}
    },
    encrypt(user,id,provider,value) {return encrypt(key(user),value,`${user}/${provider}/${id}`);},
    describeApiKey({secretRef}) {
      if(!secretRef) return {status:'not_configured',storage:'encrypted_personal_vault',writeSupported:true};
      const id=VAULT_REF_PATTERN.exec(secretRef)?.[1]; const row=id?repository.credential(id):null;
      return {status:!row?'unavailable':row.status==='revoked'?'revoked':unlocked.has(row.user_id)?'configured':'locked',storage:'encrypted_personal_vault',writeSupported:true};
    },
    resolveApiKey({secretRef,ownerUserId,providerId}) {
      const id=VAULT_REF_PATTERN.exec(secretRef)?.[1]; const row=id?repository.credential(id):null;
      if(!row || row.status!=='active' || row.user_id!==ownerUserId || row.provider_id!==providerId) throw new ApplicationError('Personal credential unavailable.',{code:'CREDENTIAL_UNAVAILABLE',statusCode:409});
      try {const value=decrypt(key(row.user_id),row.encrypted_value,`${row.user_id}/${row.provider_id}/${row.credential_id}`);try{return value.toString('utf8');}finally{value.fill(0);} }
      catch(error) {if(error.code==='VAULT_LOCKED') throw error;throw new ApplicationError('Personal credential cannot be decrypted.',{code:'CREDENTIAL_UNAVAILABLE',statusCode:409});}
    },
  };
}
