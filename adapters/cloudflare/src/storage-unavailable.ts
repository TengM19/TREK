import { StorageBackendError, StorageNotFoundError } from '../../../server/src/nest/storage/storage.types';
import { assertValidKey, assertValidPrefix } from '../../../server/src/nest/storage/storage-keys';
/** No upload can report success until a persistent object-storage driver is configured. */
export class LocalDriver {
  readonly id: string;
  constructor(opts: {id:string}) { this.id = opts.id; }
  init(): void {}
  getLocalPath(key: string): null { assertValidKey(key); return null; }
  getSpoolDir(): null { return null; }
  async put(key: string): Promise<never> { assertValidKey(key); throw new StorageBackendError('Attachments are unavailable in the initial Cloudflare demo.'); }
  async getStream(key: string): Promise<never> { assertValidKey(key); throw new StorageNotFoundError(key); }
  async stat(key: string): Promise<null> { assertValidKey(key); return null; }
  async delete(key: string): Promise<void> { assertValidKey(key); }
  async *list(prefix: string): AsyncGenerator<never> { assertValidPrefix(prefix); }
}
