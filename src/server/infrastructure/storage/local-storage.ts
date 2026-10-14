import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  StorageKeyError,
  type StorageProvider,
  type StoredObject,
} from '@/server/domain/ports/storage';
import { serverEnv } from '@/lib/env';
import { ConfigurationError } from '@/lib/errors';

/**
 * Local filesystem storage, for development and small deployments.
 *
 * Three properties matter and are enforced here rather than trusted:
 *
 *  * **The caller never names the file.** A key is `<prefix>/<32 random hex>`,
 *    so nothing a user supplies reaches the filesystem. Path traversal has no
 *    entry point because there is no user-controlled path component.
 *  * **Every resolved path is re-checked against the root.** Even a key issued
 *    by this application is verified to land inside the storage root before it
 *    is opened, so a corrupted database row cannot read `/etc/passwd`.
 *  * **The root is never inside the application directory.** Uploaded files
 *    are customer documents, not source code: a build, a redeploy or a careless
 *    `git add` must not be able to sweep them up or wipe them out. As with the
 *    bank's other systems, they default to a sibling folder
 *    (`../NibValutionStorage`), and a root inside the project is refused.
 */

const KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}\/[0-9a-f]{32}(\.[a-z0-9]{1,8})?$/;

/** Beside the application folder, e.g. `C:\NibValution` → `C:\NibValutionStorage`. */
export function defaultStorageRoot(): string {
  return path.resolve(process.cwd(), '..', 'NibValutionStorage');
}

export class LocalStorageProvider implements StorageProvider {
  readonly name = 'local';
  private readonly root: string;

  constructor(root?: string) {
    // The root is runtime configuration outside the app, so there is nothing to
    // trace; without the hint Turbopack bundles the whole project into the output.
    this.root = path.resolve(
      /*turbopackIgnore: true*/ root ?? serverEnv.STORAGE_LOCAL_ROOT ?? defaultStorageRoot(),
    );
    assertOutsideApplication(this.root);
  }

  /** Resolve a key to an absolute path, refusing anything outside the root. */
  private resolve(key: string): string {
    if (!KEY_PATTERN.test(key)) {
      throw new StorageKeyError(key);
    }
    const resolved = path.resolve(this.root, key);
    const rootWithSep = this.root.endsWith(path.sep) ? this.root : this.root + path.sep;
    if (!resolved.startsWith(rootWithSep)) {
      // Belt and braces: the pattern above already makes this unreachable.
      throw new StorageKeyError(key);
    }
    return resolved;
  }

  private static sanitizePrefix(prefix: string): string {
    const clean = prefix.toLowerCase().replace(/[^a-z0-9._-]/g, '');
    if (clean.length === 0) return 'misc';
    return clean.slice(0, 64);
  }

  async put(prefix: string, data: Buffer, contentType: string): Promise<StoredObject> {
    const safePrefix = LocalStorageProvider.sanitizePrefix(prefix);
    const extension = extensionForContentType(contentType);
    const key = `${safePrefix}/${randomBytes(16).toString('hex')}${extension}`;
    const target = this.resolve(key);

    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data, { flag: 'wx' });

    return {
      key,
      sizeBytes: data.length,
      sha256: createHash('sha256').update(data).digest('hex'),
    };
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }

  async move(fromKey: string, toPrefix: string): Promise<string> {
    const source = this.resolve(fromKey);
    const safePrefix = LocalStorageProvider.sanitizePrefix(toPrefix);
    const basename = path.basename(fromKey);
    const key = `${safePrefix}/${basename}`;
    const target = this.resolve(key);

    await mkdir(path.dirname(target), { recursive: true });
    await rename(source, target);
    return key;
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }
}

/** Refuse a storage root that is the application directory or anywhere inside it. */
function assertOutsideApplication(root: string): void {
  const relative = path.relative(process.cwd(), root);
  const inside =
    relative === '' || (relative.split(path.sep)[0] !== '..' && !path.isAbsolute(relative));
  if (inside) {
    throw new ConfigurationError(
      `STORAGE_LOCAL_ROOT "${root}" is inside the application directory. ` +
        `Uploaded files must be stored outside the code, e.g. ${defaultStorageRoot()}.`,
    );
  }
}

/**
 * A file extension for the stored object.
 *
 * Purely so an operator browsing the storage directory can tell what they are
 * looking at; nothing reads it back, and the database is the authority on type.
 */
function extensionForContentType(contentType: string): string {
  switch (contentType) {
    case 'application/pdf':
      return '.pdf';
    case 'image/jpeg':
      return '.jpg';
    case 'image/png':
      return '.png';
    case 'image/tiff':
      return '.tif';
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return '.docx';
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      return '.xlsx';
    default:
      return '.bin';
  }
}
