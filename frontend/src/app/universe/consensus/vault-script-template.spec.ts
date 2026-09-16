import { describe, it, expect, vi } from 'vitest';
import { script, opcodes } from 'bitcoinjs-lib';
import { Point } from '@noble/secp256k1';
import { Subject } from 'rxjs';
import { compileVaultScripts } from './vault-script-template';
import { VaultsSimulateComponent } from './vaults-simulate.component';
const hot = Point.BASE.toHex(true),
  cold = Point.BASE.multiply(2n).toHex(true);
describe('actual vault script construction', () => {
  it.each([1, 16, 17, 127, 128, 144, 65535])(
    'serializes the exact branches and minimal CSV delay %i',
    (delay) => {
      const result = compileVaultScripts(hot, cold, delay, 'ab'.repeat(32));
      const expected = script.compile([
        opcodes.OP_IF,
        Buffer.from(cold, 'hex'),
        opcodes.OP_CHECKSIG,
        opcodes.OP_ELSE,
        script.number.encode(delay),
        opcodes.OP_CHECKSEQUENCEVERIFY,
        opcodes.OP_DROP,
        Buffer.from(hot, 'hex'),
        opcodes.OP_CHECKSIG,
        opcodes.OP_ENDIF,
      ]);
      expect(result.unvaultScript).toBe(expected.toString('hex'));
      expect(result.vaultScript).toBe(
        script
          .compile([
            opcodes.OP_IF,
            Buffer.from(cold, 'hex'),
            opcodes.OP_CHECKSIG,
            opcodes.OP_ELSE,
            Buffer.from(hot, 'hex'),
            opcodes.OP_CHECKSIGVERIFY,
            Buffer.alloc(32, 0xab),
            opcodes.OP_NOP4,
            opcodes.OP_ENDIF,
          ])
          .toString('hex')
      );
    }
  );
  it('rejects invalid keys, equal key roles, invalid delays and missing commitment', () => {
    for (const delay of [0, -1, 1.5, 65536, NaN])
      expect(() =>
        compileVaultScripts(hot, cold, delay, 'ab'.repeat(32))
      ).toThrow();
    expect(() => compileVaultScripts(hot, hot, 144, 'ab'.repeat(32))).toThrow(
      /differ/
    );
    expect(() =>
      compileVaultScripts('02' + 'ff'.repeat(32), cold, 144, 'ab'.repeat(32))
    ).toThrow();
    expect(() => compileVaultScripts(hot, cold, 144, '')).toThrow(/exact/);
  });
  it('discards pending CTV evidence on edit/network switch and sends actual transaction bytes', () => {
    const pending = new Subject<any>(),
      network = new Subject<string>(),
      api = { simulateCovenant$: vi.fn(() => pending) };
    const component = new VaultsSimulateComponent(
      api as any,
      { markForCheck: vi.fn() } as any,
      { networkChanged$: network } as any
    );
    component.transactionHex = '0102';
    component.covenantScript = '20' + 'ab'.repeat(32) + 'b3';
    component.inputIndex = 2;
    component.runSimulation();
    expect(api.simulateCovenant$.mock.calls[0][0]).toMatchObject({
      transaction_hex: '0102',
      input_index: 2,
      covenant_script: component.covenantScript,
    });
    component.edited();
    pending.next({ valid: true });
    expect(component.result).toBeNull();
    component.runSimulation();
    network.next('signet');
    pending.next({ valid: true });
    expect(component.result).toBeNull();
    component.ngOnDestroy();
  });
});
