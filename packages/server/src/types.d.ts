declare module 'y-websocket/bin/utils' {
  import * as Y from 'yjs';
  import { IncomingMessage } from 'http';
  export function setupWSConnection(conn: any, req: IncomingMessage, options?: { docName?: string; gc?: boolean }): void;
  export function setPersistence(persistence: { bindState: (docName: string, ydoc: Y.Doc) => void; writeState: (docName: string, ydoc: Y.Doc) => Promise<void> }): void;
}
