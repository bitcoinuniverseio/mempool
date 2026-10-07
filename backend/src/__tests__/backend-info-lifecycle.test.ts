import backendInfo, { BackendInfo } from '../api/backend-info';

const network = jest.fn(async () => ({ subversion: 'controlled-test' }));
const chain = jest.fn(async () => ({ blocks: 1, headers: 1, initialblockdownload: false, verificationprogress: 1, chain: 'signet' }));
jest.mock('../api/bitcoin/bitcoin-client', () => ({ __esModule: true, default: { getNetworkInfo: () => network(), getBlockchainInfo: () => chain() } }));
jest.mock('../logger', () => ({ __esModule: true, default: { err: jest.fn(), debug: jest.fn() } }));

afterAll(() => backendInfo.stopPolling());

it('keeps both real background timer handles unreferenced without changing polling intervals', () => {
  const interval = jest.spyOn(global, 'setInterval');
  const info = new BackendInfo();
  try {
    expect(interval.mock.calls.map(([, delay]) => delay)).toEqual([600000, 30000]);
    const handles = interval.mock.results.map(result => result.value as NodeJS.Timeout);
    expect(handles.map(handle => handle.hasRef())).toEqual([false, false]);
    const clear = jest.spyOn(global, 'clearInterval');
    info.stopPolling(); info.stopPolling();
    expect(clear).toHaveBeenCalledWith(handles[0]); expect(clear).toHaveBeenCalledWith(handles[1]);
    clear.mockRestore();
  } finally { info.stopPolling(); interval.mockRestore(); }
});

it('continues scheduled observations while alive and stops future polling explicitly', async () => {
  const originalInterval = global.setInterval;
  const interval = jest.spyOn(global, 'setInterval').mockImplementation((callback: any) => originalInterval(callback, 5));
  const info = new BackendInfo();
  try {
    const started = network.mock.calls.length;
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(network.mock.calls.length).toBeGreaterThan(started);
    info.stopPolling();
    const stoppedNetwork = network.mock.calls.length, stoppedChain = chain.mock.calls.length;
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(network.mock.calls.length).toBe(stoppedNetwork); expect(chain.mock.calls.length).toBe(stoppedChain);
  } finally { info.stopPolling(); interval.mockRestore(); }
});
