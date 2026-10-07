import { AddressReadAdmission } from '../api/bitcoin/address-read-admission';
import { classifyAddressError, addressErrorStatus } from '../api/bitcoin/address-errors';

it('rejects excess work immediately without invoking or queueing it', async () => {
  const guard = new AddressReadAdmission(2);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const first = guard.run(() => held), second = guard.run(() => held);
  const work = jest.fn(async () => 3);
  await expect(guard.run(work)).rejects.toMatchObject({ code: 'EADDRESSBUSY' });
  expect(work).not.toHaveBeenCalled();
  release(); await Promise.all([first, second]);
  await expect(guard.run(work)).resolves.toBe(3);
});
it('releases capacity after a failing provider without changing the failure', async () => {
  const guard = new AddressReadAdmission(1), failure = Error('source failed');
  await expect(guard.run(async () => { throw failure; })).rejects.toBe(failure);
  await expect(guard.run(async () => 4)).resolves.toBe(4);
});
it('reports temporary capacity as retryable HTTP429 rather than an address defect', () => {
  expect(classifyAddressError({ code: 'EADDRESSBUSY' })).toBe('address-backend-busy');
  expect(addressErrorStatus('address-backend-busy')).toBe(429);
});
