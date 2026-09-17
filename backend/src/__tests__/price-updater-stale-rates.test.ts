/**
 * A stored fiat observation is never advertised as the current price unless
 * the feed is enabled for this network and the observation is fresh; the
 * stored row is exposed with its timestamp, source and an explicit state.
 */
const configState = {
  MEMPOOL: { NETWORK: 'mainnet', PRICE_UPDATES_PER_HOUR: 1 },
  DATABASE: { ENABLED: true },
  FIAT_PRICE: { ENABLED: false, API_KEY: '' },
};
const repositoryState = { stored: null as Record<string, number> | null };

jest.mock('../config', () => ({ __esModule: true, default: configState }));
jest.mock('../repositories/PricesRepository', () => ({
  __esModule: true,
  MAX_PRICES: {},
  default: {
    $getLatestConversionRates: /** @asyncUnsafe test double */ async () => repositoryState.stored ?? emptyPrices(),
  },
}));
jest.mock('../tasks/price-feeds/bitfinex-api', () => ({ __esModule: true, default: class { currencies = []; } }));
jest.mock('../tasks/price-feeds/bitflyer-api', () => ({ __esModule: true, default: class { currencies = []; } }));
jest.mock('../tasks/price-feeds/coinbase-api', () => ({ __esModule: true, default: class { currencies = []; } }));
jest.mock('../tasks/price-feeds/gemini-api', () => ({ __esModule: true, default: class { currencies = []; } }));
jest.mock('../tasks/price-feeds/kraken-api', () => ({ __esModule: true, default: class { currencies = []; } }));
jest.mock('../tasks/price-feeds/free-currency-api', () => ({ __esModule: true, default: class {} }));

import priceUpdater, { PRICE_MAX_AGE_SECONDS } from '../tasks/price-updater';

function emptyPrices(): Record<string, number> {
  const prices: Record<string, number> = { time: 0 };
  for (const currency of ['USD', 'EUR', 'GBP', 'CAD', 'CHF', 'AUD', 'JPY', 'BGN', 'BRL', 'CNY', 'CZK', 'DKK', 'HKD', 'HRK', 'HUF', 'IDR', 'ILS', 'INR', 'ISK', 'KRW', 'MXN', 'MYR', 'NOK', 'NZD', 'PHP', 'PLN', 'RON', 'RUB', 'SEK', 'SGD', 'THB', 'TRY', 'ZAR']) {
    prices[currency] = -1;
  }
  return prices;
}

const NOW_MS = Date.UTC(2026, 8, 17, 12, 0, 0);
const STALE_TIME = Math.round(NOW_MS / 1000) - 30 * 24 * 3600;
const FRESH_TIME = Math.round(NOW_MS / 1000) - 600;

function storedFixture(time: number): Record<string, number> {
  return { ...emptyPrices(), time, USD: 61_234, EUR: 56_789 };
}

function reset(): void {
  const subject = priceUpdater as unknown as Record<string, unknown>;
  subject.latestPrices = priceUpdater.getEmptyPricesObj();
  subject.latestGoodPrices = priceUpdater.getEmptyPricesObj();
  subject.storedPrices = null;
  subject.liveSource = null;
}

describe('stored fiat rates with the feed disabled', () => {
  beforeEach(() => {
    reset();
    configState.MEMPOOL.NETWORK = 'mainnet';
    configState.FIAT_PRICE.ENABLED = false;
    repositoryState.stored = storedFixture(STALE_TIME);
  });

  it('does not advertise the stored observation as the current price', /** @asyncUnsafe Jest owns the test promise. */ async () => {
    await priceUpdater.$initializeLatestPriceWithDb(NOW_MS);
    expect(priceUpdater.getLatestPrices().USD).toBe(-1);
    const advertised = priceUpdater.getAdvertisedPrices(NOW_MS);
    expect(advertised.USD).toBe(-1);
    expect(advertised).toMatchObject({
      state: 'disabled',
      disabled: true,
      stale: true,
      source: 'database',
      observedAt: STALE_TIME,
      ageSeconds: 30 * 24 * 3600,
    });
    expect(advertised.storedObservation).toMatchObject({ time: STALE_TIME, USD: 61_234, EUR: 56_789 });
  });

  it('reports network-inapplicable on signet even with a stored row', /** @asyncUnsafe Jest owns the test promise. */ async () => {
    configState.MEMPOOL.NETWORK = 'signet';
    configState.FIAT_PRICE.ENABLED = true;
    repositoryState.stored = storedFixture(FRESH_TIME);
    await priceUpdater.$initializeLatestPriceWithDb(NOW_MS);
    expect(priceUpdater.getLatestPrices().USD).toBe(-1);
    expect(priceUpdater.getAdvertisedPrices(NOW_MS)).toMatchObject({ state: 'network-inapplicable', disabled: true, USD: -1 });
  });
});

describe('stored fiat rates with the feed enabled', () => {
  beforeEach(() => {
    reset();
    configState.MEMPOOL.NETWORK = 'mainnet';
    configState.FIAT_PRICE.ENABLED = true;
  });

  it('serves a fresh stored observation as live from the database', /** @asyncUnsafe Jest owns the test promise. */ async () => {
    repositoryState.stored = storedFixture(FRESH_TIME);
    await priceUpdater.$initializeLatestPriceWithDb(NOW_MS);
    expect(priceUpdater.getLatestPrices().USD).toBe(61_234);
    expect(priceUpdater.getAdvertisedPrices(NOW_MS)).toMatchObject({
      state: 'live', stale: false, disabled: false, source: 'database', observedAt: FRESH_TIME, USD: 61_234, storedObservation: null,
    });
  });

  it('keeps a stale stored observation out of the live price', /** @asyncUnsafe Jest owns the test promise. */ async () => {
    repositoryState.stored = storedFixture(Math.round(NOW_MS / 1000) - PRICE_MAX_AGE_SECONDS - 1);
    await priceUpdater.$initializeLatestPriceWithDb(NOW_MS);
    expect(priceUpdater.getLatestPrices().USD).toBe(-1);
    const advertised = priceUpdater.getAdvertisedPrices(NOW_MS);
    expect(advertised).toMatchObject({ state: 'stale', stale: true, disabled: false, source: 'database', USD: -1 });
    expect(advertised.storedObservation?.USD).toBe(61_234);
  });

  it('reports unavailable when nothing is stored', /** @asyncUnsafe Jest owns the test promise. */ async () => {
    repositoryState.stored = null;
    await priceUpdater.$initializeLatestPriceWithDb(NOW_MS);
    expect(priceUpdater.getAdvertisedPrices(NOW_MS)).toMatchObject({ state: 'unavailable', stale: false, source: null, observedAt: null, storedObservation: null });
  });
});
