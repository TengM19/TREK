import { AsyncLocalStorage } from 'node:async_hooks';
import type Database from 'better-sqlite3';
import { DurableSqlite } from './sqlite';

export const databaseContext = new AsyncLocalStorage<DurableSqlite>();

export const db = new Proxy({} as Database.Database, {
  get(_target, property) {
    const connection = databaseContext.getStore();
    if (!connection) throw new Error('Database access outside a Durable Object request');
    const value = Reflect.get(connection, property);
    return typeof value === 'function' ? value.bind(connection) : value;
  },
});

export function closeDb(): never {
  throw new Error('File-database restore is unavailable for Durable Object storage');
}
export function reinitialize(): never {
  throw new Error('File-database restore is unavailable for Durable Object storage');
}
