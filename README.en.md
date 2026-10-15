# Bitcoin Backtest Lab

A local BTC/USDT research workbench with a separate TypeScript backtest engine, historical-data validation, and Python strategy callbacks.

**Portfolio showcase — all rights reserved.** Source is visible for inspection. Running, reusing, modifying, distributing, or selling the project requires prior written permission, subject to the exceptions in [LICENSE](LICENSE). The setup instructions below are for the owner and authorized users.

The project demonstrates research infrastructure: explicit execution assumptions, inspectable trade accounting, and persistence. Strategy results are simulations and depend on the stated model.

## Quick start

Requires Node.js 22.13+; Python 3.9+ for Python callbacks.

```sh
npm ci
npm test
npm run dev
```

Open http://127.0.0.1:5173. Use the explicitly labelled synthetic demo to explore the workbench without downloading market data. The interface is in Turkish; the full operating guide is in [README.md](README.md).

## Where to review the engineering

| Component            | Location                                        | What to inspect                                                  |
| -------------------- | ----------------------------------------------- | ---------------------------------------------------------------- |
| Backtest engine      | `shared/engine.ts`                              | Next-bar execution, fees, slippage, stops, equity and benchmarks |
| Calculation tests    | `tests/engine.test.ts`                          | Hand-checkable trade accounting and historical-fill invariance   |
| Rule evaluation      | `tests/candle-rules.test.ts`                    | Custom candle conditions                                         |
| Python integration   | `tests/python.test.ts`                          | Strategy callbacks and process behavior                          |
| Data and persistence | `tests/market.test.ts`, `tests/storage.test.ts` | Historical data and workspace handling                           |
| Local API boundary   | `tests/local-access.test.ts`                    | Local request access controls                                    |

On 13 September 2026, the existing unit suite passed **78 tests across 6 files** at revision `d457582fd25bc41c2a0216d524df713ef4a2e2b3`. This is a unit-test result; live exchange and browser integration checks were not rerun in that review.

## Evaluation model

- Only closed, continuous OHLCV candles are accepted. The one exception is Binance’s own outages: when Binance returns a later candle, the skipped open times are confirmed never to have traded, so they are skipped (not filled in) and counted in the report. Live data starts at the BTCUSDT listing on 17 August 2017. Signals execute at the following candle’s open.
- The portfolio is spot, long-only, unlevered, and holds at most one position.
- Entry and exit both incur commission and adverse slippage. Unallocated capital stays in cash.
- If stop-loss and take-profit are both crossed inside a candle, the stop takes precedence. Stop gaps use the opening price.
- Equity is marked at candle closes. The engine closes a remaining position at the end of the sample.
- The buy-and-hold comparator uses the same fee and slippage settings, with full capital allocation.

The model does not simulate order-book liquidity, partial fills, market impact, funding or short borrowing. OHLCV data cannot establish the exact intrabar path. The reported annualized Sharpe uses bar returns and is descriptive, not a significance test. Repeated strategy selection on the same data is not independent out-of-sample validation.

## Reproducible examples and sharing

Synthetic demo data are deterministic and labelled separately from market data. Existing workspace backups may include personal reports and custom strategy code; they are not required for a reviewer to inspect the engine or run its unit tests. Python callbacks execute trusted local code and are not a multi-user sandbox.

A useful next experiment is a frozen chronological comparison of simple baselines, with data provenance, parameters, and result artifacts saved together. No predictive advantage is claimed by the existence of this workbench.

## License

Copyright (c) 2026 Bilgehan Erdemir. **All rights reserved.** This project is not offered under an open-source license. Commercial and noncommercial use require prior written permission, except where applicable law, GitHub's Terms of Service, or a separate applicable license permits otherwise. For permission requests, contact the author through [GitHub](https://github.com/bilgehanerdmr) or open an issue.

Third-party components retain their own licenses. Versions previously released under ISC retain their ISC permissions; this change does not revoke those permissions. See [LICENSE](LICENSE) for the full notice.
