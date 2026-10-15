import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { errorHandler, HttpError } from '../server/errors';

function handle(err: Error) {
  const json = vi.fn(),
    status = vi.fn((_code: number) => ({ json }));
  errorHandler(err, {} as Request, { status } as unknown as Response, (() => {}) as NextFunction);
  return { status: status.mock.calls[0][0], body: json.mock.calls[0][0] };
}
const parserError = (type: string, status: number) =>
  Object.assign(new SyntaxError('Unexpected token } in JSON'), { type, status });
afterEach(() => vi.restoreAllMocks());
describe('API error responses', () => {
  it('keeps validation messages as 400', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(handle(new Error('Geçerli bir tarih aralığı seçin.'))).toEqual({
      status: 400,
      body: { error: 'Geçerli bir tarih aralığı seçin.' },
    });
  });
  it('uses the status of known upstream and setup failures', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(handle(new HttpError(502, 'Binance bağlantısı kurulamadı.'))).toEqual({
      status: 502,
      body: { error: 'Binance bağlantısı kurulamadı.' },
    });
    expect(handle(new HttpError(503, 'Binance istek sınırı.')).status).toBe(503);
  });
  it('translates body-parser failures instead of leaking English parser messages', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(handle(parserError('entity.parse.failed', 400))).toEqual({
      status: 400,
      body: { error: 'İstek gövdesi geçerli JSON değil.' },
    });
    expect(handle(parserError('entity.too.large', 413))).toEqual({
      status: 413,
      body: { error: 'İstek boyutu sınırı aşıyor.' },
    });
    expect(handle(parserError('encoding.unsupported', 415))).toEqual({
      status: 415,
      body: { error: 'İstek gövdesi okunamadı.' },
    });
  });
  it('hides internal failures behind a generic 500 and logs them in full', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bug = new TypeError("Cannot read properties of undefined (reading 'ids')");
    expect(handle(bug)).toEqual({
      status: 500,
      body: { error: expect.stringMatching(/beklenmeyen/) },
    });
    expect(log).toHaveBeenCalledWith(bug);
    const sqlite = Object.assign(new Error('database is locked'), { code: 'ERR_SQLITE_ERROR' });
    expect(handle(sqlite).status).toBe(500);
  });
});
