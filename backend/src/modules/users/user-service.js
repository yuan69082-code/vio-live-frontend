import { ConflictError, NotFoundError } from '../../core/errors.js';
import { createId } from '../../core/ids.js';
import { normalizeEmail, optionalString, requireString } from '../../core/validation.js';

export function createUserService({
  userRepository,
  userSpaceRepository,
  runInTransaction,
  clock = () => new Date(),
  idFactory = createId,
}) {
  return {
    createUser(input) {
      const email = normalizeEmail(input?.email);
      const displayName = optionalString(input?.displayName, 'displayName', { maxLength: 80 });

      if (userRepository.findByEmail(email)) {
        throw new ConflictError('A user with this email already exists.');
      }

      const now = clock().toISOString();
      const user = {
        userId: idFactory(),
        email,
        displayName,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      };

      return runInTransaction(() => {
        const created = userRepository.insert(user);
        userSpaceRepository.insert({
          spaceId: idFactory(),
          userId: created.userId,
          identityMode: 'development_unverified',
          status: 'active',
          currentAssistantId: null,
          createdAt: now,
          updatedAt: now,
        });
        return created;
      });
    },
    getUser(userId) {
      const normalizedId = requireString(userId, 'userId', { maxLength: 128 });
      const user = userRepository.findById(normalizedId);

      if (!user) {
        throw new NotFoundError('User was not found.');
      }

      return user;
    },
  };
}
