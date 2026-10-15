import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Candle } from '../shared/types';
import {
  validatePythonStrategy,
  type PythonStrategy,
  type PythonSignal,
} from '../shared/python-strategy';
import { HttpError } from './errors';

const runner = fileURLToPath(new URL('./python-runner.py', import.meta.url));
export async function runPython(
  strategy: PythonStrategy,
  candles: Candle[] | null,
  options: { timeoutMs?: number; executable?: string } = {},
): Promise<PythonSignal[]> {
  validatePythonStrategy(strategy);
  const directory = await mkdtemp(path.join(tmpdir(), 'bitcoin-python-'));
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(
        options.executable ?? process.env.BTC_PYTHON ?? 'python3',
        ['-I', '-B', runner],
        {
          cwd: directory,
          // Do not inherit credentials or application environment variables.
          env: {
            PATH: process.env.PATH,
            ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
          },
          stdio: ['pipe', 'pipe', 'pipe'],
          detached: process.platform !== 'win32',
        },
      );
      let output = '',
        bytes = 0,
        failure = '';
      const kill = () => {
        try {
          if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
          else child.kill('SIGKILL');
        } catch {
          /* Process already exited. */
        }
      };
      const timer = setTimeout(() => {
        failure =
          'Python süre sınırı aşıldı. Sonsuz döngüleri kaldırın veya tarih aralığını daraltın (15 sn).';
        kill();
      }, options.timeoutMs ?? 15000);
      child.on('error', (error: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        // A missing or broken interpreter is a server setup problem, not a strategy error.
        reject(
          new HttpError(
            500,
            error.code === 'ENOENT'
              ? 'Python bulunamadı. Python 3.9+ kurun veya BTC_PYTHON ile Python çalıştırıcısının yolunu belirtin.'
              : 'Python başlatılamadı: ' + error.message,
          ),
        );
      });
      const collect = (buffer: Buffer, stdout: boolean) => {
        bytes += buffer.length;
        if (bytes > 2 * 1024 * 1024) {
          failure = 'Python çıktı sınırı aşıldı (2 MB).';
          kill();
        } else if (stdout) output += buffer.toString('utf8');
      };
      child.stdout.on('data', (b: Buffer) => collect(b, true));
      child.stderr.on('data', (b: Buffer) => collect(b, false));
      child.stdin.on('error', () => {
        /* Early exit is reported by close. */
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        kill(); // Also clean up subprocesses left by a strategy on POSIX.
        try {
          if (failure) throw new Error(failure);
          if (code !== 0)
            throw new Error('Python işlemi sonlandı. Kaynak sınırlarını ve kodunuzu kontrol edin.');
          let result;
          try {
            result = JSON.parse(output);
          } catch {
            throw new Error('Python geçerli bir sonuç üretmedi.');
          }
          if (result.error) throw new Error(String(result.error));
          if (candles === null) {
            if (result.ok !== true) throw new Error('Python kod kontrolü tamamlanamadı.');
            resolve([]);
          } else {
            if (
              !Array.isArray(result.signals) ||
              result.signals.length !== candles.length ||
              result.signals.some((s: unknown) => !['buy', 'sell', 'hold'].includes(s as string))
            )
              throw new Error('Python sinyalleri geçersiz.');
            resolve(result.signals);
          }
        } catch (error) {
          reject(error);
        }
      });
      child.stdin.end(
        JSON.stringify({ strategy, candles, mode: candles === null ? 'validate' : 'run' }),
      );
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
