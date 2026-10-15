import { expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { localAccess } from '../server/local-access';

it.each([
  [{ host: '127.0.0.1:3001', origin: 'http://127.0.0.1:5173' }, true],
  [{ host: 'localhost:3001' }, true],
  [{ host: 'evil.example:3001' }, false],
  [{ host: '127.0.0.1:3001', origin: 'https://evil.example' }, false],
  [{ host: '127.0.0.1:3001', origin: 'null' }, false],
  [{ host: '127.0.0.1:3001', 'sec-fetch-site': 'cross-site' }, false],
])('restricts local code execution requests: %j', (headers, allowed) => {
  const next = vi.fn(),
    json = vi.fn(),
    status = vi.fn(() => ({ json }));
  localAccess({ headers } as Request, { status } as unknown as Response, next);
  expect(next).toHaveBeenCalledTimes(allowed ? 1 : 0);
  expect(status.mock.calls).toEqual(allowed ? [] : [[403]]);
});
