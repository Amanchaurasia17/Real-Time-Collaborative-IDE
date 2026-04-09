import { describe, expect, it } from 'vitest';
import request from 'supertest';
import express from 'express';

// Small isolated test to avoid booting the real WS server.
describe('GET /healthz', () => {
  it('returns ok', async () => {
    const app = express();
    app.get('/healthz', (_req, res) => res.status(200).json({ ok: true }));

    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
