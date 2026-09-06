import {
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

function within(root, target) {
  const rel = relative(root, target);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function assertNoLinks(root, target, allowMissingLeaf = false) {
  let cursor = target;
  const pending = [];
  while (within(root, cursor) && cursor !== root) {
    pending.push(cursor);
    cursor = dirname(cursor);
  }
  pending.push(root);
  for (const path of pending.reverse()) {
    try {
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new Error('Managed attachment path contains a link.');
    } catch (error) {
      if (error?.code === 'ENOENT' && (allowMissingLeaf || path !== root)) continue;
      throw error;
    }
  }
}

export function createManagedChatAttachmentStore({root}) {
  if (typeof root !== 'string' || !isAbsolute(root)) {
    throw new Error('Managed chat attachment root must be absolute.');
  }
  const canonicalRoot = resolve(root);

  function pathFor(storageRef) {
    if (!/^[a-f0-9]{64}$/.test(storageRef)) throw new Error('Attachment storage reference is invalid.');
    const target = resolve(join(canonicalRoot, storageRef.slice(0, 2), storageRef));
    if (!within(canonicalRoot, target)) throw new Error('Attachment storage escaped its managed root.');
    return target;
  }

  return Object.freeze({
    root: canonicalRoot,
    put(storageRef, bytes) {
      const target = pathFor(storageRef);
      assertNoLinks(canonicalRoot, target, true);
      mkdirSync(dirname(target), {recursive: true});
      assertNoLinks(canonicalRoot, dirname(target));
      const temporary = `${target}.tmp`;
      writeFileSync(temporary, bytes, {flag: 'wx'});
      try {
        renameSync(temporary, target);
      } catch (error) {
        rmSync(temporary, {force: true});
        throw error;
      }
      return storageRef;
    },
    read(storageRef) {
      const target = pathFor(storageRef);
      assertNoLinks(canonicalRoot, target);
      const canonical = realpathSync(target);
      if (!within(canonicalRoot, canonical)) throw new Error('Attachment storage escaped its managed root.');
      return readFileSync(canonical);
    },
    remove(storageRef) {
      const target = pathFor(storageRef);
      assertNoLinks(canonicalRoot, target);
      rmSync(target, {force: false});
    },
  });
}
