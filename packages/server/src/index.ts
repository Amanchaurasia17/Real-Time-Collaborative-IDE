import http from 'node:http';
import { createRequire } from 'node:module';
import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { exec } from 'node:child_process';
import { writeFile, unlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

const execPromise = promisify(exec);
// y-websocket ships utils as JS; this import path is the canonical embed approach.
import { setupWSConnection, setPersistence } from 'y-websocket/bin/utils';
import type * as Yjs from 'yjs';

const PORT = Number(process.env.PORT ?? 1234);
const WS_PATH = process.env.WS_PATH ?? '/collab';
const PERSISTENCE_DIR = process.env.YPERSISTENCE ?? './.yjs-data';

const require = createRequire(import.meta.url);
// Important: use the same CJS-loaded Yjs instance as y-websocket to avoid
// duplicate Yjs imports (constructor checks break otherwise).
const Y = require('yjs') as typeof import('yjs');
const { LeveldbPersistence } = require('y-leveldb') as {
  LeveldbPersistence: new (dir: string) => {
    getYDoc: (docName: string) => Promise<Yjs.Doc>;
    storeUpdate: (docName: string, update: Uint8Array) => Promise<void> | void;
  };
};

const ldb = new LeveldbPersistence(PERSISTENCE_DIR);
setPersistence({
  provider: ldb,
  bindState: async (docName: string, ydoc: Yjs.Doc) => {
    const persistedYdoc = await ldb.getYDoc(docName);
    const newUpdates = Y.encodeStateAsUpdate(ydoc);
    await ldb.storeUpdate(docName, newUpdates);
    Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(persistedYdoc));

    ydoc.on('update', async (update: Uint8Array) => {
      await ldb.storeUpdate(docName, update);
    });
  },
  writeState: async (_docName: string, _ydoc: Yjs.Doc) => { }
});

const app = express();
app.use(cors());
app.use(express.json());

app.get('/healthz', (_req, res) => {
  res.status(200).json({ ok: true });
});

app.post('/api/run', async (req, res) => {
  const { code, language } = req.body;
  if (!code) {
    return res.status(400).json({ error: 'No code provided' });
  }

  const tmpPath = join(tmpdir(), 'rce-' + Math.random().toString(36).slice(2));
  
  try {
    await mkdir(tmpPath, { recursive: true });
    
    let output = '';
    
    if (language === 'cpp') {
      const src = join(tmpPath, 'solution.cpp');
      const bin = join(tmpPath, 'solution.exe');
      await writeFile(src, code);
      try {
        await execPromise(`g++ "${src}" -o "${bin}"`);
        const { stdout, stderr } = await execPromise(`"${bin}"`, { timeout: 3000 });
        output = stdout + stderr;
      } catch (e: any) {
        output = 'COMPILATION/RUNTIME ERROR:\n' + (e.stderr || e.message);
      }
    } else if (language === 'python') {
      const src = join(tmpPath, 'solution.py');
      await writeFile(src, code);
      try {
        const { stdout, stderr } = await execPromise(`python "${src}"`, { timeout: 3000 });
        output = stdout + stderr;
      } catch (e: any) {
        output = 'RUNTIME ERROR:\n' + (e.stderr || e.message);
      }
    } else if (language === 'javascript') {
      const src = join(tmpPath, 'solution.js');
      await writeFile(src, code);
      try {
        const { stdout, stderr } = await execPromise(`node "${src}"`, { timeout: 3000 });
        output = stdout + stderr;
      } catch (e: any) {
        output = 'RUNTIME ERROR:\n' + (e.stderr || e.message);
      }
    } else {
      output = `Language ${language} not supported for native execution.`;
    }

    res.json({ output: output || 'Finished with no output.' });

  } catch (error: any) {
    res.json({ output: 'System Execution Error: ' + error.message });
  } finally {
    // Cleanup - ignore errors
    try { await unlink(tmpPath).catch(() => {}); } catch(e) {}
  }
});

app.get('/healthz', (_req, res) => {
  res.status(200).json({ ok: true });
});

const server = http.createServer(app);

// y-websocket clients connect to `${serverUrl}/${roomname}`.
// Our UI uses `serverUrl = ws://localhost:1234${WS_PATH}` so connections come in as:
//   /collab/<room>
// The y-websocket server expects req.url like `/<room>`.
const wss = new WebSocketServer({ server });
wss.on('connection', (conn: any, req: any) => {
  const url = req.url ?? '';

  // Only handle websocket traffic under WS_PATH.
  // Everything else gets closed immediately.
  const prefix = WS_PATH.endsWith('/') ? WS_PATH.slice(0, -1) : WS_PATH;
  if (url === prefix || url === `${prefix}/`) {
    // No room provided; reject.
    conn.close();
    return;
  }
  if (!url.startsWith(`${prefix}/`)) {
    conn.close();
    return;
  }

  // Rewrite '/collab/<room>?q=..' -> '/<room>?q=..'
  req.url = url.slice(prefix.length);
  setupWSConnection(conn, req, { gc: true });
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`collab server listening on http://localhost:${PORT}`);
  // eslint-disable-next-line no-console
  console.log(`ws endpoint: ws://localhost:${PORT}${WS_PATH}`);
  // eslint-disable-next-line no-console
  console.log(`persistence dir: ${PERSISTENCE_DIR}`);
});
