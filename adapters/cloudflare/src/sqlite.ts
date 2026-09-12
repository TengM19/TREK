/** The synchronous SQL surface supplied by a SQLite-backed Durable Object. */
export interface SqlEngine {
  exec(query: string, ...bindings: SqlValue[]): SqlCursor;
}
export type SqlValue = string | number | null | ArrayBuffer;
export interface SqlCursor extends Iterable<Record<string, SqlValue>> {
  toArray(): Record<string, SqlValue>[];
  columnNames: string[];
}
export interface SqlStore {
  sql: SqlEngine;
  transactionSync<T>(callback: () => T): T;
}

function values(args: unknown[]): SqlValue[] {
  const flattened = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
  return flattened.map(value => {
    if (value === null || typeof value === 'string' || typeof value === 'number') return value;
    if (value instanceof ArrayBuffer) return value;
    if (ArrayBuffer.isView(value)) return Uint8Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)).buffer;
    throw new TypeError('SQLite bindings must be numbers, strings, null, or byte buffers');
  });
}

/** Rewrite named parameters only in SQL tokens, never inside literals or comments. */
function bind(query: string, args: unknown[]): { query: string; args: unknown[] } {
  const named = args.find(value => value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof ArrayBuffer) && !ArrayBuffer.isView(value)) as Record<string, unknown> | undefined;
  if (!named) return { query, args };
  const positional = args.filter(value => value !== named).flat();
  const bound: unknown[] = [];
  let position = 0;
  const rewritten = query.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|--[^\n]*|\/\*[\s\S]*?\*\/|[:@$]([A-Za-z_][A-Za-z0-9_]*)|\?/g, (token, name: string | undefined) => {
    if (name) {
      if (!Object.prototype.hasOwnProperty.call(named, name)) throw new RangeError(`Missing named SQLite parameter: ${name}`);
      bound.push(named[name]);
      return '?';
    }
    if (token === '?') bound.push(positional[position++]);
    return token;
  });
  if (position !== positional.length) throw new RangeError('Too many positional SQLite parameters');
  return { query: rewritten, args: bound };
}

/**
 * Compatibility seam for TREK's synchronous statements and transactions.
 * It delegates durable writes and rollback to the platform, not an in-memory copy.
 * File backups, extensions and durability pragmas are deliberately not emulated.
 */
export class DurableSqlite {
  readonly name = 'durable-object';
  readonly memory = false;
  readonly readonly = false;
  readonly open = true;

  constructor(private readonly store: SqlStore) {}

  prepare(query: string) {
    const execute = (...args: unknown[]) => {
      const bound = bind(query, args);
      return this.store.sql.exec(bound.query, ...values(bound.args));
    };
    return {
      get: (...args: unknown[]) => execute(...args).toArray()[0],
      all: (...args: unknown[]) => execute(...args).toArray(),
      iterate: (...args: unknown[]) => execute(...args)[Symbol.iterator](),
      run: (...args: unknown[]) => {
        execute(...args).toArray();
        const row = this.store.sql.exec('SELECT changes() AS changes, last_insert_rowid() AS lastInsertRowid').toArray()[0];
        return { changes: Number(row.changes), lastInsertRowid: Number(row.lastInsertRowid) };
      },
    };
  }

  exec(query: string): this {
    this.store.sql.exec(query).toArray();
    return this;
  }

  pragma(source: string, options?: { simple?: boolean }): unknown {
    const cursor = this.store.sql.exec(`PRAGMA ${source}`);
    const columns = cursor.columnNames;
    const rows = cursor.toArray();
    return options?.simple ? rows[0]?.[columns[0]] : rows;
  }

  transaction<TArgs extends unknown[], TResult>(callback: (...args: TArgs) => TResult) {
    return (...args: TArgs): TResult => this.store.transactionSync(() => {
      const result = callback(...args);
      if (result && typeof (result as { then?: unknown }).then === 'function') {
        throw new TypeError('SQLite transactions must be synchronous');
      }
      return result;
    });
  }
}
