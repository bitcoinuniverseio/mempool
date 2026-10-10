import { AddressReadAdmission } from '../api/bitcoin/address-read-admission';
import { withElectrumDeadline } from '../api/bitcoin/electrum-deadline';

const deferred = <T = unknown>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } => { let resolve: (value: T) => void, reject: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve: (value: T): void => resolve(value), reject: (error: unknown): void => reject(error) }; };
const turn = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
afterEach(() => jest.useRealTimers());

it('caller deadlines retain the existing two leases until every raw TCP completion, with no queue', async () => {
  jest.useFakeTimers();
  const admission = new AddressReadAdmission(2), raw = [deferred(), deferred()];
  const dispatch = jest.fn((index: number) => raw[index].promise);
  const calls = raw.map((_value, index) => admission.run(() => withElectrumDeadline(admission.track(() => dispatch(index)), 'get_balance', 15000)));
  const ended = calls.map(call => call.catch(error => error));
  await turn(); expect(dispatch).toHaveBeenCalledTimes(2);
  jest.advanceTimersByTime(15000); await Promise.all(ended);
  const third = jest.fn(async () => 'new-scope');
  await expect(admission.run(third)).rejects.toMatchObject({ code: 'EADDRESSBUSY' }); expect(third).not.toHaveBeenCalled();
  raw[0].resolve('old-scope'); await turn();
  await expect(admission.run(async () => 'fresh-scope')).resolves.toBe('fresh-scope');
  raw[1].reject(Error('late TCP failure')); await turn();
  await expect(admission.run(async () => 'another fresh read')).resolves.toBe('another fresh read');
  expect(dispatch).toHaveBeenCalledTimes(2);
});

it('a five-second caller cancellation returns promptly but cannot release an unanswered raw owner', async () => {
  jest.useFakeTimers(); const admission = new AddressReadAdmission(1), raw = deferred();
  const abort = deferred();
  const call = admission.run(() => Promise.race([admission.track(() => raw.promise), abort.promise]));
  const ended = call.catch(error => error); await turn();
  jest.advanceTimersByTime(5000); abort.reject(Object.assign(Error('caller cancelled'), { code: 'ETIMEDOUT' }));
  expect(await ended).toMatchObject({ code: 'ETIMEDOUT' });
  await expect(admission.run(async () => 'not admitted')).rejects.toMatchObject({ code: 'EADDRESSBUSY' });
  raw.resolve('late old response'); await turn();
  await expect(admission.run(async () => 'new observation')).resolves.toBe('new observation');
});

it('inherits an outer route lease without double counting and isolates independent roots', async () => {
  const admission = new AddressReadAdmission(1), raw = deferred();
  const first = admission.run(() => admission.inheritOrRun(() => admission.track(() => raw.promise)));
  await turn();
  await expect(admission.run(async () => 'other root')).rejects.toMatchObject({ code: 'EADDRESSBUSY' });
  raw.resolve('first'); await expect(first).resolves.toBe('first');
  await expect(admission.inheritOrRun(async () => 'direct capability')).resolves.toBe('direct capability');
});

it('sealed late continuations never dispatch, including factories queued before caller terminal', async () => {
  const admission = new AddressReadAdmission(1), dispatch = jest.fn(async () => 'native');
  // A continuation retains the originating async context, unlike a new caller.
  const gate = deferred(); let result: Promise<unknown> | undefined;
  await admission.run(async () => {
    result = gate.promise.then(() => admission.track(dispatch));
    return 'ended';
  });
  gate.resolve(undefined); await expect(result).rejects.toMatchObject({ code: 'EADDRESSBUSY' });
  expect(dispatch).not.toHaveBeenCalled();
  let queued: Promise<unknown> | undefined;
  await admission.run(async () => {
    queueMicrotask(() => { queued = admission.track(dispatch); });
    return 'caller terminal';
  });
  await expect(queued).rejects.toMatchObject({ code: 'EADDRESSBUSY' });
  expect(dispatch).not.toHaveBeenCalled();
  await expect(admission.run(async () => 'retry')).resolves.toBe('retry');
});

it('synchronous factories and late rejections settle owned bookkeeping without leaks', async () => {
  const admission = new AddressReadAdmission(1);
  await expect(admission.run(() => admission.track(() => { throw Error('factory failed'); }))).rejects.toThrow('factory failed');
  await expect(admission.run(() => { throw Error('read factory failed'); })).rejects.toThrow('read factory failed');
  await expect(admission.run(async () => 'retry')).resolves.toBe('retry');
});

it('one settled raw cannot release a caller-ended owner that still owns another raw', async () => {
  const admission = new AddressReadAdmission(1), raws = [deferred(), deferred()], cancel = deferred();
  const result = admission.run(() => Promise.race([
    Promise.all(raws.map(raw => admission.track(() => raw.promise))), cancel.promise,
  ]));
  const ended = result.catch(error => error); await turn(); cancel.reject(Error('caller ended')); await ended;
  raws[0].resolve('first'); await turn();
  const blocked = jest.fn(async () => 'third root');
  await expect(admission.run(blocked)).rejects.toMatchObject({ code: 'EADDRESSBUSY' }); expect(blocked).not.toHaveBeenCalled();
  raws[1].resolve('last'); await turn();
  await expect(admission.run(async () => 'fresh scope')).resolves.toBe('fresh scope');
});

it('a stale scope continuation cannot inherit a sealed lease or dispatch a raw factory', async () => {
  const admission = new AddressReadAdmission(1), gate = deferred(), dispatch = jest.fn(async () => 'wrong old scope');
  let late: Promise<unknown> | undefined;
  await admission.run(async () => { late = gate.promise.then(() => admission.inheritOrRun(() => admission.track(dispatch))); return 'old scope ended'; });
  const current = admission.run(async () => 'new scope'); gate.resolve(undefined);
  await expect(late).rejects.toMatchObject({ code: 'EADDRESSBUSY' }); await expect(current).resolves.toBe('new scope');
  expect(dispatch).not.toHaveBeenCalled();
});
