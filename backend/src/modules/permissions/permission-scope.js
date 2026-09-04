import { NotFoundError } from '../../core/errors.js';
import { requireString } from '../../core/validation.js';

// Explicit null denotes a verified personal account scope. Omission remains invalid.
// This extends the existing permission/confirmation pipeline, not a parallel bypass.
export function requirePermissionSubject(userId,subjectId,userRepository,subjectRepository) {
  if (subjectId===null && userRepository.isPersonalIdentity?.(userId)) return null;
  const id=requireString(subjectId,'subjectId',{maxLength:128});
  if (!subjectRepository.findById(userId,id)) throw new NotFoundError('Subject was not found for this user.');
  return id;
}
