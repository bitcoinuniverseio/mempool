describe('BackendInfo refresh scheduling', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  it('does not keep tests or shutdown waiting on recurring refresh timers', () => {
    const unref = jest.fn();
    const timer = { unref } as unknown as NodeJS.Timeout;
    const setIntervalSpy = jest
      .spyOn(global, 'setInterval')
      .mockImplementation(() => timer);

    jest.doMock('../api/bitcoin/bitcoin-client', () => ({
      __esModule: true,
      default: {
        getNetworkInfo: jest
          .fn()
          .mockResolvedValue({ subversion: '/Satoshi:29.0/' }),
        getBlockchainInfo: jest.fn().mockResolvedValue({
          blocks: 1,
          headers: 1,
          initialblockdownload: false,
          verificationprogress: 1,
        }),
      },
    }));
    jest.doMock('../logger', () => ({
      __esModule: true,
      default: { debug: jest.fn(), err: jest.fn() },
    }));

    jest.isolateModules(() => {
      const { BackendInfo } = require('../api/backend-info') as {
        BackendInfo: new (startRefresh: boolean) => unknown;
      };
      new BackendInfo(true);
    });

    expect(setIntervalSpy).toHaveBeenCalledTimes(2);
    expect(unref).toHaveBeenCalledTimes(2);
  });

  it('does not start RPC refresh work from the test singleton', () => {
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    const getNetworkInfo = jest.fn();
    const getBlockchainInfo = jest.fn();
    jest.doMock('../api/bitcoin/bitcoin-client', () => ({
      __esModule: true,
      default: { getNetworkInfo, getBlockchainInfo },
    }));

    jest.isolateModules(() => {
      require('../api/backend-info');
    });

    expect(setIntervalSpy).not.toHaveBeenCalled();
    expect(getNetworkInfo).not.toHaveBeenCalled();
    expect(getBlockchainInfo).not.toHaveBeenCalled();
  });
});
