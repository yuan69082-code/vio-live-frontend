import { ValidationError } from '../../core/errors.js';

export function fields(value, allowed, required = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new ValidationError('Unsupported request fields.', { field: 'body' });
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) throw new ValidationError('Required field is missing.', { field: key });
  }
  return value;
}
export function text(value, field, max = 160, min = 1) {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max
      || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) {
    throw new ValidationError('Invalid text field.', { field });
  }
  return value.trim();
}
export function version(value, field = 'expectedVersion') {
  if (!Number.isSafeInteger(value) || value < 1) throw new ValidationError('Invalid version.', { field });
  return value;
}
export function avatar(value) {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > 180000
      || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new ValidationError('Avatar must be a bounded PNG, JPEG or WebP image.', { field: 'avatar' });
  }
  const data = Buffer.from(value.slice(value.indexOf(',') + 1), 'base64');
  const valid = value.startsWith('data:image/png;') ? data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : value.startsWith('data:image/jpeg;') ? data[0] === 255 && data[1] === 216 && data[2] === 255
      : data.toString('ascii',0,4) === 'RIFF' && data.toString('ascii',8,12) === 'WEBP';
  if (!valid) throw new ValidationError('Avatar image signature is invalid.', { field: 'avatar' });
  return value;
}
export const CONTEXT_MODES = Object.freeze(['concise','balanced','complete','custom']);
export function preferences(value) {
  fields(value, ['storagePreference','contextMode'], ['storagePreference','contextMode']);
  if (!['local','cloud','hybrid'].includes(value.storagePreference) || !CONTEXT_MODES.includes(value.contextMode)) {
    throw new ValidationError('Unsupported preference.', { field: 'preferences' });
  }
  return { ...value };
}
export function assistantInput(value) {
  fields(value, ['name','avatar','settings','expectedVersion'], ['name','avatar','settings']);
  const settings = fields(value.settings, ['positioning','personality','persona','requirements','contextMode']);
  const normalized = {};
  for (const key of ['positioning','personality','persona','requirements']) normalized[key] = text(settings[key] ?? '', `settings.${key}`, 4000, 0);
  normalized.contextMode = settings.contextMode ?? 'balanced';
  if (!CONTEXT_MODES.includes(normalized.contextMode)) throw new ValidationError('Unsupported context preference.', {field:'settings.contextMode'});
  return { name:text(value.name,'name',80), avatar:avatar(value.avatar), settings:normalized };
}
