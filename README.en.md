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
| Paper trading        | `server/paper.ts`, `tests/paper.test.ts`        | Live sessions run through the same engine; parity tests          |

On 13 September 2026, the existing unit suite passed **78 tests across 6 files** at revision `d457582fd25bc41c2a0216d524df713ef4a2e2b3`. This is a unit-test result; live exchange and browser integration checks were not rerun in that review.

## Evaluation model

- Only closed, continuous OHLCV candles are accepted. The one exception is Binance’s own outages: when Binance returns a later candle, the skipped open times are confirmed never to have traded, so they are skipped (not filled in) and counted in the report. Live data starts at the BTCUSDT listing on 17 August 2017. Signals execute at the following candle’s open.
- The portfolio is spot, long-only, unlevered, and holds at most one position.
- Entry and exit both incur commission and adverse slippage. Unallocated capital stays in cash.
- If stop-loss and take-profit are both crossed inside a candle, the stop takes precedence. Stop gaps use the opening price.
- Equity is marked at candle closes. The engine closes a remaining position at the end of the sample.
- The buy-and-hold comparator uses the same fee and slippage settings, with full capital allocation.

The model does not simulate order-book liquidity, partial fills, market impact, funding or short borrowing. OHLCV data cannot establish the exact intrabar path. The reported annualized Sharpe uses bar returns and is descriptive, not a significance test. Repeated strategy selection on the same data is not independent out-of-sample validation.

## Paper trading

The **Canlı Test** tab runs a built-in, custom candle, or Python strategy on live Binance BTC/USDT candles with a virtual portfolio. No orders are sent and no API key is used.

- Sessions run on the server, not in the browser. Closed candles come from the Binance kline WebSocket (`k.x`); after a disconnect, or 15 seconds after a close that was not received, missing candles are fetched over REST.
- A configurable number of earlier candles warms up the strategy. Trades, equity, buy-and-hold, and metrics count only from the first candle that opens after the start.
- Every closed candle runs the session's whole candle series through the backtest engine's own functions (`strategySignals`, `stepPortfolio`, `summarize`), so the execution rules are identical. Python strategies are replayed from the warmup start on each candle, so their `state` matches a backtest; a strategy that returns different signals for candles already processed stops with an error instead of rewriting history.
- Data gaps follow the backtest rule: candles Binance proves never existed are skipped and counted; an unconfirmed gap puts the session in a waiting state, with no trades and no invented candles.
- Each session stores a copy of its strategy code and settings, plus its signals, trades, and equity in SQLite. After a restart, active sessions resume and process the candles they missed.
- Stopping saves a report labelled “Canlı (paper)”. It applies the backtest's end-of-test rule, so it equals a backtest of the same candles. “Aynı dönemi backtest et” re-reads the candles, runs a fresh backtest (a single Python pass), shows both side by side, and saves it labelled “Karşılaştırma”.
- Limits: three active sessions; 50,000 candles per session including warmup (about 34 days on 1m), after which the session stops itself and saves its report; at least three traded candles per report. Fills are simulated from OHLCV candles; order-book depth, latency, and partial fills are not modelled.
- An offline, explicitly labelled demo stream (synthetic candles, real time or one candle per second) drives the browser tests.

The parity tests in `tests/paper.test.ts` feed candles one at a time and compare every intermediate state and the final report with a backtest of the same candles, for each built-in strategy, a custom candle strategy, Python, and a series containing Binance outages.

## Reproducible examples and sharing

Synthetic demo data are deterministic and labelled separately from market data. Existing workspace backups may include personal reports and custom strategy code; they are not required for a reviewer to inspect the engine or run its unit tests. Python callbacks execute trusted local code and are not a multi-user sandbox. Backups include paper sessions; imported sessions arrive stopped, so importing never runs strategy code.

A useful next experiment is a frozen chronological comparison of simple baselines, with data provenance, parameters, and result artifacts saved together. No predictive advantage is claimed by the existence of this workbench.

## License

Copyright (c) 2026 Bilgehan Erdemir. **All rights reserved.** This project is not offered under an open-source license. Commercial and noncommercial use require prior written permission, except where applicable law, GitHub's Terms of Service, or a separate applicable license permits otherwise. For permission requests, contact the author through [GitHub](https://github.com/bilgehanerdmr) or open an issue.

Third-party components retain their own licenses. Versions previously released under ISC retain their ISC permissions; this change does not revoke those permissions. See [LICENSE](LICENSE) for the full notice.
