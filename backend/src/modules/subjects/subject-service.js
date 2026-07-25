import { NotFoundError } from '../../core/errors.js';
import { createId } from '../../core/ids.js';
import {
  optionalString,
  requirePlainObject,
  requireString,
} from '../../core/validation.js';

export function createSubjectService({
  subjectRepository,
  userRepository,
  clock = () => new Date(),
  idFactory = createId,
}) {
  return {
    createSubject(ownerUserId, input) {
      const normalizedUserId = requireString(ownerUserId, 'userId', { maxLength: 128 });

      if (!userRepository.findById(normalizedUserId)) {
        throw new NotFoundError('Owner user was not found.');
      }

      const name = requireString(input?.name, 'name', { maxLength: 80 });
      const avatarRef = optionalString(input?.avatarRef, 'avatarRef', { maxLength: 2_048 });
      const basicSettings = requirePlainObject(input?.basicSettings, 'basicSettings');
      const now = clock().toISOString();
      const subject = {
        subjectId: idFactory(),
        ownerUserId: normalizedUserId,
        name,
        avatarRef,
        basicSettings,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      };

      return subjectRepository.insert(subject);
    },
    getSubject(ownerUserId, subjectId) {
      const normalizedUserId = requireString(ownerUserId, 'userId', { maxLength: 128 });
      const normalizedSubjectId = requireString(subjectId, 'subjectId', { maxLength: 128 });
      const subject = subjectRepository.findById(normalizedUserId, normalizedSubjectId);

      if (!subject) {
        throw new NotFoundError('Subject was not found for this user.');
      }

      return subject;
    },
  };
}
