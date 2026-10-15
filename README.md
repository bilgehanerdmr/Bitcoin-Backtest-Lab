# Bitcoin Backtest Lab

A local BTC/USDT research and backtesting platform with a Turkish interface.

For a concise engineering overview, see the [research overview](README.en.md). This guide uses English descriptions alongside the Turkish labels shown in the application.

## Repository and starter data

Repository: [bilgehanerdmr/Bitcoin-Backtest-Lab](https://github.com/bilgehanerdmr/Bitcoin-Backtest-Lab).

```sh
git clone https://github.com/bilgehanerdmr/Bitcoin-Backtest-Lab.git
cd Bitcoin-Backtest-Lab
npm ci
npm run dev
```

A portable snapshot of the workspace is included in **`backups/initial-workspace.json`**. In the application, open **Data Center → Choose backup file** (`Veri Merkezi → Yedek dosyası seç`), select this file, and click **Start import** (`İçe aktarmayı başlat`). The file contains the candles and reports present when the snapshot was taken. Templates and reports created by automated tests have been removed. The snapshot is not imported automatically and does not update when your local data changes. Export a new backup from the application to transfer your latest data.

Working SQLite files, dependencies, and generated build/test output are excluded from Git. The repository carries data as a portable JSON backup.

## Running locally

Requires **Node.js 22.13 or later**. SQLite uses Node's built-in `node:sqlite` module.

```sh
npm install
npm run dev
```

Interface: **http://127.0.0.1:5173** · API: http://127.0.0.1:3001

To run a production build locally:

```sh
npm run build
npm start
```

In this mode, both the interface and API are served at **http://127.0.0.1:3001**. Set `PORT` to change the server port; during `npm run dev`, the development proxy uses the same `PORT` value.

## Features

- Real-time Binance Spot BTC/USDT prices and candlestick charts over WebSocket, with reconnection and a REST fallback every 30 seconds.
- 1m, 5m, 15m, 1h, 4h, and 1d candles; panning, zooming, SMA indicators, and volume.
- Paginated historical downloads by date range, missing-data checks, verification of Binance data gaps, and SQLite caching.
- SMA crossover, Wilder RSI mean reversion, and Donchian channel breakout strategies.
- Custom candle strategy editor: price, body, wick, percentage, and volume conditions; separate entry/exit groups and reusable patterns.
- Python Strategy Workshop: `.py` uploads, code editing, syntax checks, local templates, and backtests driven by Python signals.
- Capital, position allocation, entry/exit fees and slippage, stop-loss, and take-profit settings.
- Net return, buy-and-hold benchmark, maximum drawdown, win rate, profit factor, annualized Sharpe, and total fees.
- Equity and drawdown charts, paginated trade history, and CSV export.
- Automatically saved reports, comparison of up to three reports, individual/bulk deletion, and paginated loading of older reports.
- Strategy templates and capital/risk defaults stored in SQLite.
- Explicitly labelled, deterministic synthetic demo mode; it never activates automatically when live data fails.
- Desktop and mobile layouts with a Turkish interface and UTC timestamps.

For a one-minute backtest, select **Timeframe → 1m** (`Zaman dilimi → 1m`) in the terminal. Set the chart timeframe separately using the **1m** button above the chart. Historical one-minute candles are downloaded from Binance in pages and cached. The limit of 50,000 candles per test corresponds to about 34.7 days; select at most 34 days when using full days. The candle currently forming is excluded from the backtest.

## Creating a custom candle strategy

Open **Strategies → Create custom strategy** (`Stratejiler → Özel strateji oluştur`), or use **Strategy → Custom Candle Strategy → Edit candle rules** (`Strateji → Özel Mum Stratejisi → Mum kurallarını düzenle`) in the terminal.

Each condition compares a candle value with a constant or another candle value. Examples:

- Bullish candle: the last closed candle's close > its open.
- Long lower wick: the last closed candle's lower wick ≥ its body × 2.
- Price breakout: the last closed candle's close > the preceding candle's high.
- Small body: body / total candle range ≤ 10%.
- Volume increase: the last closed candle's volume > the preceding candle's volume × 1.5.

The “last closed candle” is the signal candle; lookback offsets range from 0 to 20 candles. The body is `abs(close − open)`, the upper wick is `high − max(open, close)`, and the lower wick is `min(open, close) − low`. The total range is `high − low`; percentage ratios are undefined for a zero-range candle, so the corresponding condition does not match. Prices and lengths use USDT, volume uses BTC, and ratios use percentages. Compared candle values must use matching units; constants use the unit of the field on the left.

Entry and exit each have an **AND** (`VE`, all conditions) or **OR** (`VEYA`, at least one condition) group. Entry groups contain 1–20 conditions; exit groups contain 0–20. This editor does not support nested logic groups, custom Python/JavaScript execution, or indicator expressions. Leaving the exit group empty uses only the configured stop-loss/take-profit and end-of-test exit. Built-in examples include bullish engulfing, long lower wick, and three rising candles; selecting an example replaces the current entry/exit rules.

Patterns are evaluated only on closed candles, with execution at the next candle's open. Evaluation waits until enough data is available for the largest lookback across all entry/exit conditions. If entry and exit match simultaneously, exit takes priority. Only one position is held; custom strategies do not re-enter on the same candle as an exit. A new entry is possible if the conditions match again on a later candle.

The editor preview counts matches among the current chart's closed candles; it does not simulate positions, fees, or stops. Run a backtest for the actual trade count. **Apply rules** (`Kuralları uygula`) updates the current test configuration. **Save strategy as template** (`Stratejiyi şablon olarak kaydet`) stores rules in local SQLite for reuse. Completed reports also retain their rules in SQLite and display them under **Tested candle rules** (`Test edilen mum kuralları`).

## Data source

REST: `https://data-api.binance.vision/api/v3`

WebSocket: `wss://data-stream.binance.vision/stream`

No API key is required. An internet connection and access to Binance's market-data domains are required. The interface displays connection status when regional restrictions or network errors prevent access. For 429/418 responses, the server respects `Retry-After`. Ticker data is cached on the server for 5 seconds; historical candle downloads are queued.

Official references: [Binance public market data](https://github.com/binance/binance-spot-api-docs/blob/master/faqs/market_data_only.md), [REST API](https://github.com/binance/binance-spot-api-docs/blob/master/rest-api.md), [WebSocket streams](https://github.com/binance/binance-spot-api-docs/blob/master/web-socket-streams.md).

Charts use [TradingView Lightweight Charts™](https://www.tradingview.com/). Library license: [Apache 2.0 and NOTICE](https://github.com/tradingview/lightweight-charts).

## Backtest methodology

1. Only closed, continuous OHLCV candles are used, except for Binance data gaps such as exchange outages (for example, maintenance on 8–9 February 2018 and the interruption on 24 March 2023, 12:39–14:00 UTC). When Binance returns a later candle, the application treats the skipped open times as unavailable on the exchange; it skips them without fabricating candles and reports their count. Missing candles without a later published candle produce an error. Live data starts on 17 August 2017, the BTCUSDT listing date; earlier start dates are rejected. A test processes at most 50,000 candles. Future end dates are clipped to the last closed candle. Indicators and candle rules use adjacent available candles across a gap.
2. Indicator warmup takes place within the selected range. A signal calculated at the previous close executes at the next candle's open. The model is spot, long-only, unleveraged, and limited to one position.
3. Slippage increases buy prices and decreases sell prices. Fees apply on both entry and exit. The position budget includes the entry fee; unallocated capital remains in cash.
4. Stop-loss and take-profit levels are based on the entry price after slippage. A value of 0 disables the rule. If both levels are crossed within one candle, stop-loss takes priority. A gap through the stop at the open is filled at that candle's opening price. Strategy exit signals and intrabar levels are evaluated afterward.
5. Any remaining position closes at the final candle's close. Entry/exit timestamps identify the opening time of the execution candle; exact intrabar execution times cannot be inferred from OHLCV data.
6. Equity is marked to market at each close. Maximum drawdown is calculated from this series and does not measure intrabar drawdown. Open-position valuations do not deduct a hypothetical exit fee; actual exits do.
7. Sharpe uses candle returns and sample standard deviation, with a zero risk-free rate and annualization over 365 days. It is undefined when variance is zero. Profit factor is shown as `null` / `—` when there are no losing trades.
8. Buy-and-hold runs from the first candle's open to the final close of the same range, using 100% capital and the same fee/slippage settings. Its curve shows hypothetical net liquidation value at each candle.

Liquidity, partial fills, quantity/price increments, market impact, futures, and funding fees are not modelled. The application does not submit real orders. Historical results do not guarantee future performance.

## Storage and architecture

- `src/`: React + TypeScript interface and charts.
- `shared/engine.ts`: standalone calculation engine and validation.
- `server/`: Express API, Binance client, and SQLite persistence.
- `data/bitcoin-lab.sqlite`: automatically created database for real candle caching and reports. Demo candles are not stored in the real-data table; demo reports are saved with a source label.
- `DATABASE_PATH`: alternative SQLite file path. Its parent directory must already exist.
- Templates and preferences are stored in the same SQLite file's `workspace` table. Legacy `localStorage` templates are merged into SQLite on first load; old keys are removed after a successful save.

The application is a local workspace for one user, bound to `127.0.0.1`. It has no accounts, cloud synchronization, JavaScript code execution, or automatic parameter optimization. The Python runner is intended for trusted local code and is unsuitable for a public, multi-user deployment.

## Loading a Python strategy

Open **Strategies → Upload Python strategy** (`Stratejiler → Python stratejisi yükle`) or **Backtest Terminal → Strategy → Python Strategy → Upload / edit Python code** (`Backtest Terminali → Strateji → Python Stratejisi → Python kodunu yükle / düzenle`).

1. Select a `.py` file or paste code into the editor. Source code is limited to 64 KB of UTF-8 text. Use **Download example .py** (`Örnek .py indir`) to get a working engulfing strategy.
2. **Check syntax** (`Sözdizimini kontrol et`) checks syntax and the `on_candle` definition without executing the code. Runtime errors appear during the backtest.
3. **Save and use** (`Kaydet ve kullan`) saves the code and current test settings to the local SQLite template library. An edited version is added as a new template; the previous version is retained.
4. Select the timeframe (for example, **1m**), dates, and risk settings, then click **Start Backtest** (`Backtest Başlat`). The report includes a copy of the code used, available under **Tested Python code** (`Test edilen Python kodu`).

Function interface:

```python
def on_candle(candles, state):
    if len(candles) < 2:
        return "hold"
    previous, current = candles[-2], candles[-1]
    if current["close"] > previous["high"]:
        return "buy"
    if current["close"] < previous["low"]:
        return "sell"
    return "hold"
```

- `candles` is a read-only ordered view of candles closed so far; it supports indexing, slicing, iteration, and `len()`. Future candles are never passed to the function. Across Binance outages, the `time` difference between consecutive candles may exceed the selected interval. Each candle contains `time` (UTC Unix seconds), `open`, `high`, `low`, `close`, and `volume` (BTC).
- The function is called for every candle; handle indicator warmup in your code. A signal on the final candle cannot open a new trade because there is no next candle.
- `state` is a dictionary that starts empty and persists between calls. Use it for your own calculations. It does not represent the actual portfolio or open position; counters that assume a position was opened may diverge from stop-loss/take-profit behavior.
- `"buy"` signals a long entry, `"sell"` signals a long exit, and `"hold"` or `None` signals no action. Trades execute at the next candle's open. Buys while a position is open and sells while flat are ignored. Shorting and adding to an existing position are unsupported.
- Fees, slippage, capital, stop-loss, take-profit, and end-of-test liquidation are handled by the shared backtest engine. Files written for another framework, such as Backtrader, must be adapted to the `on_candle` interface.

Requires **Python 3.9+**. The default command is `python3`; to use another interpreter or virtual environment, start the server with `BTC_PYTHON=/absolute/path/.venv/bin/python npm run dev`. Additional packages are not installed automatically; install them in the selected environment if needed. The user's site-packages directory is excluded by `-I`, so packages must be installed in the selected virtual environment. See the [Python isolated mode documentation](https://docs.python.org/3/using/cmdline.html#cmdoption-I).

**Run only code you trust.** Python runs in a separate process, but this is not a security sandbox: code can access files and the network with your user permissions. Uploading code, importing a backup, and checking syntax do not execute it; **Start Backtest** (`Backtest Başlat`) does. Application secrets in environment variables are not forwarded to the subprocess. The API rejects external-site Origin/Host requests; these checks do not replace user authentication.

Execution is limited to 15 seconds, source code to 64 KB, process output to 2 MB, and `print` logs to 16 KB. Logs are not included in reports. On Linux, process address space is also limited to 512 MB; the same memory limit is not applied on macOS/Windows. Optimize the computation or narrow the date range if you reach the time limit.

Python source code is included with templates and reports in **Data Center** (`Veri Merkezi`) backups. You can import the same backup on another computer with the current platform code, Python, and any required packages. Review backups containing your code before sharing them; do not embed secret keys in strategies. Older platform versions cannot open backups containing Python strategies; update the application first.

## Deleting test history and moving to another computer

- **Test History** (`Test Geçmişi`): use a row's trash icon to delete one report, or select multiple checkboxes and click **Delete selected** (`Seçilenleri sil`). The confirmation dialog lists the selected reports. Candles, strategy templates, and previously downloaded backups are retained. Use **Load older reports** (`Daha eski raporları yükle`) to access reports beyond the first 100.
- **Strategies → Your Saved Templates** (`Stratejiler → Kaydettiğiniz Şablonlar`): use the trash icon on a template card to remove it. Reports created from that template and candle data are retained.
- **Data Center → Export all data** (`Veri Merkezi → Tüm verileri dışa aktar`): downloads the entire local store as a versioned JSON backup, including candles for all timeframes, all reports/trades/equity curves, custom strategy rules, templates, and risk defaults.
- On the other computer, copy this project's code and run `npm install` and `npm run dev`. Open the JSON file through **Data Center → Choose backup file** (`Veri Merkezi → Yedek dosyası seç`), review the content counts, and click **Start import** (`İçe aktarmayı başlat`).

Imports write to the local SQLite database. Existing candles with the same timeframe and opening time, and existing reports with the same ID, are preserved. New records are added; templates with the same name and configuration are not duplicated. Defaults from the backup are applied. The entire file is validated first, then candles, reports, and workspace data are written in a single SQLite transaction; any error rolls back the whole import. Deleted reports can be restored by importing a backup created before deletion.

JSON backups are limited to **100 MB**, 1,000,000 candles, 10,000 reports, and 1,000 templates. CSV exports are for analysis and cannot be imported as backups. For larger stores, close the application and copy the entire `data/` directory to the other computer. Do not copy only the `.sqlite` file, especially while the application is running; the WAL file may contain records not yet written to the main database file.

Backups are files under your control; there is no automatic cloud synchronization. Copying the code alone does not transfer data; also transfer the JSON backup or the `data/` directory while the application is closed. If imported candles fully cover the requested date range, backtests can use them offline; live prices require an internet connection.

## Checks

```sh
npm test
npm run lint
npm run format:check
npm run build
```

Linting uses [Oxlint](https://oxc.rs/docs/guide/usage/linter) instead of ESLint: ESLint's TypeScript plugin depends on the TypeScript JavaScript API, which is unavailable in the TypeScript 7 version used by this project. Rules are configured in `.oxlintrc.json`.

For pushes to `main` and pull requests, `.github/workflows/ci.yml` runs type checking, linting, formatting checks, unit tests, and builds on Node 22.13 and 24, plus browser tests in Chrome.

Browser end-to-end tests require Google Chrome:

```sh
npm run test:e2e
```

Tests cover demo backtests, report persistence, CSV downloads, template saving, comparisons, and mobile overflow checks. Screenshots are written to `test-results/`. Playwright starts its own development server on ports 5273 (interface) and 3101 (API), using a new SQLite file in a temporary directory; your `data/` files and backups are unaffected. Set `PLAYWRIGHT_BASE_URL` to test against a running server; records created by the tests will then remain in that server's database.

To test the real Binance connection and backtests with real market data separately:

```sh
LIVE_TESTS=1 npm run test:e2e -- live.spec.ts
```

These integration tests require internet access and are skipped in the default run. Unit tests also use a temporary in-memory database to verify pagination beyond 1,000 candles, caching, missing data, unclosed candles, and the 429 retry delay.

## License

ISC. See [LICENSE](LICENSE) for details.
