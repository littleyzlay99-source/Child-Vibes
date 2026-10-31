/**
 * Minimal strict Cloudflare Workers + SQLite Durable Object + WebSocket Hibernation
 * runtime ambient types so `workers/snow-rush-server` compiles cleanly without
 * adding extra npm dependencies to the root Child Vibes `package.json`.
 */

declare global {
  interface ResponseInit {
    webSocket?: WebSocket | null;
  }

  interface WebSocket {
    accept(): void;
    serializeAttachment(attachment: unknown): void;
    deserializeAttachment(): unknown;
  }

  class WebSocketPair {
    0: WebSocket;
    1: WebSocket;
  }
}

export type SqlStorageValue = ArrayBuffer | string | number | null;

export interface SqlStorageCursor<T extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>>
  extends Iterable<T> {
  toArray(): T[];
  one(): T;
  readonly rowsRead: number;
  readonly rowsWritten: number;
}

export interface SqlStorage {
  exec<T extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>>(
    query: string,
    ...bindings: SqlStorageValue[]
  ): SqlStorageCursor<T>;
}

export interface DurableObjectStorage {
  readonly sql: SqlStorage;
  getAlarm(): Promise<number | null>;
  setAlarm(scheduledTime: number | Date): Promise<void>;
  deleteAlarm(): Promise<void>;
  deleteAll(): Promise<void>;
}

export interface DurableObjectId {
  toString(): string;
  equals(other: DurableObjectId): boolean;
  readonly name?: string;
}

export interface DurableObjectState {
  readonly id: DurableObjectId;
  readonly storage: DurableObjectStorage;
  acceptWebSocket(ws: WebSocket, tags?: string[]): void;
  getWebSockets(tag?: string): WebSocket[];
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
}

export interface DurableObjectStub {
  readonly id: DurableObjectId;
  readonly name?: string;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  idFromString(id: string): DurableObjectId;
  newUniqueId(): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

export interface SnowRushWorkerEnv {
  readonly SNOW_RUSH_ROOM: DurableObjectNamespace;
  readonly FIREBASE_PROJECT_ID: string;
  readonly FIRESTORE_DATABASE_ID: string;
  readonly SNAPSHOT_BROADCAST_HZ?: string;
  readonly ALLOWED_ORIGINS?: string;
}
