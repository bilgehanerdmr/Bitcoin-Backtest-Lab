import type { NextFunction, Request, Response } from 'express';

// A failure with a known cause and a message safe to show. Plain Errors thrown by the
// shared validators describe bad input and stay 400.
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
// Programming and system failures (TypeError, SQLite, fs) have no user-facing message.
const internal = (err: Error) =>
  err instanceof TypeError ||
  err instanceof ReferenceError ||
  err instanceof RangeError ||
  err instanceof SyntaxError ||
  'code' in err;
export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction) {
  // body-parser marks its own errors with `type` and an HTTP `status`.
  const parser = err as Error & { type?: string; status?: number };
  let status = 400,
    message = err.message || 'İşlem tamamlanamadı.';
  if (err instanceof HttpError) status = err.status;
  else if (parser.type === 'entity.too.large') {
    status = 413;
    message = 'İstek boyutu sınırı aşıyor.';
  } else if (parser.type === 'entity.parse.failed') message = 'İstek gövdesi geçerli JSON değil.';
  else if (parser.type && typeof parser.status === 'number') {
    status = parser.status;
    message = 'İstek gövdesi okunamadı.';
  } else if (internal(err)) {
    status = 500;
    message = 'Sunucuda beklenmeyen bir hata oluştu. Ayrıntılar sunucu günlüğündedir.';
  }
  if (status >= 500) console.error(err);
  else console.error(err.message);
  res.status(status).json({ error: message });
}
