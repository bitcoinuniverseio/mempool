// @vitest-environment jsdom
import 'zone.js';
import { createHash } from 'node:crypto';
import { createBase58check } from '@scure/base';
import { afterEach, beforeAll, describe, expect, it, vi, type Mock, type MockInstance } from 'vitest';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { PortfoliosStore } from '../stores/portfolios.store';
import { OnboardingComponent } from './onboarding.component';
import { deriveAccountXpubFromSeed } from '../shared/derivation';

beforeAll(() => TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()));
afterEach(() => { TestBed.resetTestingModule(); vi.restoreAllMocks(); });

describe('vault onboarding progress and retry', () => {

  it('disables duplicate creation, reports failure, then allows a successful retry', async () => {
    let fail!: (error: Error) => void;
    const store = { createVault: vi.fn(() => new Promise<void>((_resolve, reject) => { fail = reject; })), vaultKind: () => 'absent' };
    TestBed.configureTestingModule({ providers: [
      { provide: PortfoliosStore, useValue: store }, { provide: Router, useValue: { navigate: vi.fn() } },
    ] });
    const view = TestBed.createComponent(OnboardingComponent);
    view.componentInstance.step.set('vault');
    view.detectChanges();
    const inputs = view.nativeElement.querySelectorAll('input') as NodeListOf<HTMLInputElement>;
    inputs[0].value = 'test-owned-passphrase'; inputs[1].value = 'test-owned-passphrase';
    const button = view.nativeElement.querySelector('button.primary') as HTMLButtonElement;
    button.click(); view.detectChanges();
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('Creating');
    button.click();
    expect(store.createVault).toHaveBeenCalledOnce();
    fail(new Error('worker unavailable'));
    await vi.waitFor(() => { view.detectChanges(); expect(button.disabled).toBe(false); });
    expect(view.nativeElement.querySelector('[role=alert]').textContent).toContain('could not be created');
    store.createVault.mockResolvedValueOnce();
    button.click();
    await vi.waitFor(() => { view.detectChanges(); expect(view.componentInstance.step()).toBe('input'); });
    expect(view.nativeElement.textContent).toContain('Add one public address');
  });
});

describe('manual portfolio requires an unlocked durable vault', () => {
  function setup(initial: 'absent' | 'locked' | 'unlocked') {
    let kind = initial;
    const store = {
      vaultKind: (): typeof kind => kind,
      initialize: vi.fn(async () => kind),
      createVault: vi.fn(async () => { kind = 'unlocked'; }),
      unlock: vi.fn(async (_passphrase: string) => false),
      createPortfolio: vi.fn().mockResolvedValue({ id: 'durable-manual', accounts: [] }),
    };
    const navigate = vi.fn().mockResolvedValue(true);
    TestBed.configureTestingModule({ providers: [
      { provide: PortfoliosStore, useValue: store }, { provide: Router, useValue: { navigate } },
    ] });
    const view = TestBed.createComponent(OnboardingComponent);
    view.detectChanges();
    const choose = (): HTMLButtonElement => Array.from(view.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find(button => button.textContent?.includes('Create a manual-only portfolio'))!;
    const submit = (): HTMLButtonElement => view.nativeElement.querySelector('button.primary') as HTMLButtonElement;
    const passwords = (...values: string[]): void => {
      const inputs = view.nativeElement.querySelectorAll('input[type=password]') as NodeListOf<HTMLInputElement>;
      values.forEach((value, index) => { inputs[index].value = value; });
    };
    return { view, store, navigate, choose, submit, passwords, setKind: (value: typeof kind): void => { kind = value; } };
  }

  it('makes fresh manual entry finish vault setup before saving any portfolio', async () => {
    const { view, store, navigate, choose, submit, passwords } = setup('absent');
    choose().click(); view.detectChanges();
    await vi.waitFor(() => { view.detectChanges(); expect(view.componentInstance.step()).toBe('vault'); });
    expect(store.createPortfolio).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    passwords('public-test-passphrase', 'public-test-passphrase');
    submit().click();
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith(['/portfolio/p', 'durable-manual', 'overview']));
    expect(store.createVault).toHaveBeenCalledOnce();
    expect(store.createPortfolio).toHaveBeenCalledExactlyOnceWith('Manual portfolio');
  });

  it('unlocks an existing vault before manual creation and rejects a wrong passphrase', async () => {
    const { view, store, navigate, choose, submit, passwords, setKind } = setup('locked');
    choose().click(); view.detectChanges();
    await vi.waitFor(() => { view.detectChanges(); expect(view.componentInstance.step()).toBe('unlock'); });
    expect(store.createPortfolio).not.toHaveBeenCalled();
    passwords('wrong-test-passphrase'); submit().click();
    await vi.waitFor(() => { view.detectChanges(); expect(view.nativeElement.querySelector('[role=alert]')?.textContent).toContain('did not unlock'); });
    expect(store.createPortfolio).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    store.unlock.mockImplementationOnce(async () => { setKind('unlocked'); return true; });
    passwords('correct-test-passphrase'); submit().click();
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith(['/portfolio/p', 'durable-manual', 'overview']));
    expect(store.createVault).not.toHaveBeenCalled();
    expect(store.createPortfolio).toHaveBeenCalledExactlyOnceWith('Manual portfolio');
  });

  it('probes a direct entry before treating an existing locked vault as absent', async () => {
    const { view, store, choose, setKind } = setup('absent');
    store.initialize.mockImplementationOnce(async () => { setKind('locked'); return 'locked'; });
    choose().click(); view.detectChanges();
    await vi.waitFor(() => { view.detectChanges(); expect(view.componentInstance.step()).toBe('unlock'); });
    expect(store.initialize).toHaveBeenCalledOnce();
    expect(store.createVault).not.toHaveBeenCalled();
    expect(store.createPortfolio).not.toHaveBeenCalled();
  });

  it('prevents duplicate manual creation while the durable write is pending', async () => {
    const { view, store, navigate, choose } = setup('unlocked');
    let finish!: (value: { id: string; accounts: [] }) => void;
    store.createPortfolio.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    choose().click(); view.detectChanges();
    expect(choose().disabled).toBe(true);
    choose().click();
    expect(store.createPortfolio).toHaveBeenCalledExactlyOnceWith('Manual portfolio');
    expect(navigate).not.toHaveBeenCalled();
    finish({ id: 'durable-manual', accounts: [] });
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledOnce());
    expect(store.initialize).not.toHaveBeenCalled();
    expect(store.createVault).not.toHaveBeenCalled();
  });

  it('keeps a failed manual write on the entry screen and retries in the unlocked vault', async () => {
    const { view, store, navigate, choose } = setup('unlocked');
    store.createPortfolio.mockRejectedValueOnce(new Error('quota exceeded'));
    choose().click(); view.detectChanges();
    await vi.waitFor(() => { view.detectChanges(); expect(view.nativeElement.querySelector('[role=alert]')?.textContent).toContain('could not be saved'); });
    expect(navigate).not.toHaveBeenCalled();
    expect(view.componentInstance.step()).toBe('choose');
    choose().click();
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledOnce());
    expect(store.createVault).not.toHaveBeenCalled();
    expect(store.createPortfolio).toHaveBeenLastCalledWith('Manual portfolio');
  });
});

describe('open one address without saving', () => {
  const publicAddress = '1BoatSLRHtKNngkdXEeobR76b53LETtpyT';
  // Public version/payload fixtures use Node's independent SHA256 implementation.
  const checkedBase58 = createBase58check((bytes) => createHash('sha256').update(bytes).digest());
  const checkedAddress = (version: number[], size = 20, fill = 42): string =>
    checkedBase58.encode(Uint8Array.from([...version, ...new Array(size).fill(fill)]));

  function setup(mode?: string, vaultKind = 'absent'): {
    view: ComponentFixture<OnboardingComponent>;
    store: { vaultKind: () => string; createVault: Mock; createPortfolio: Mock; updatePortfolio: Mock };
    navigate: Mock;
    storageWrite: MockInstance;
  } {
    const store = { vaultKind: (): string => vaultKind, createVault: vi.fn(),
      createPortfolio: vi.fn().mockResolvedValue({ id: 'local-test', accounts: [] }), updatePortfolio: vi.fn().mockResolvedValue(undefined) };
    const navigate = vi.fn().mockResolvedValue(true);
    const storageWrite = vi.spyOn(Storage.prototype, 'setItem');
    TestBed.configureTestingModule({ providers: [
      { provide: PortfoliosStore, useValue: store }, { provide: Router, useValue: { navigate } },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(mode ? { mode } : {}) } } },
    ] });
    const view = TestBed.createComponent(OnboardingComponent);
    view.detectChanges();
    return { view, store, navigate, storageWrite };
  }

  function enter(view: ReturnType<typeof setup>['view'], value: string): HTMLButtonElement {
    const input = view.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    expect(input).not.toBeNull();
    input.value = value;
    input.dispatchEvent(new Event('input'));
    view.detectChanges();
    return view.nativeElement.querySelector('button.primary') as HTMLButtonElement;
  }

  it('asks for the address before navigation and never creates a vault or portfolio', async () => {
    const { view, store, navigate, storageWrite } = setup();
    const choose = Array.from(view.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find((button) => button.textContent?.includes('Open one address without saving'))!;
    choose.click(); view.detectChanges();
    expect(navigate).not.toHaveBeenCalled();
    expect(view.componentInstance.step()).toBe('input');
    const button = enter(view, publicAddress);
    expect(button.disabled).toBe(false);
    expect(button.textContent).toContain('Open without saving');
    button.click();
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith(['/portfolio', 'bitcoin', 'mainnet', publicAddress]));
    expect(store.createVault).not.toHaveBeenCalled();
    expect(store.createPortfolio).not.toHaveBeenCalled();
    expect(store.updatePortfolio).not.toHaveBeenCalled();
    expect(storageWrite).not.toHaveBeenCalled();
  });

  it('opens the same public input from the home lookup link mode', () => {
    const { view, navigate } = setup('ephemeral');
    expect(view.componentInstance.step()).toBe('input');
    expect(view.nativeElement.querySelector('textarea')).not.toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it.each([
    'bc1qexample000000000000000', 'not-an-address', publicAddress.slice(0, -1) + 'U',
    `${publicAddress}\n${publicAddress}`, `${publicAddress} ${publicAddress}`,
    `${publicAddress},${publicAddress}`, `[{"address":"${publicAddress}"}]`,
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    'xprv' + '1'.repeat(107), 'f'.repeat(64),
  ])('rejects invalid, private or multiple input without writing or routing', async (value) => {
    const { view, store, navigate, storageWrite } = setup('ephemeral');
    const button = enter(view, value);
    expect(button.disabled).toBe(true);
    expect(view.nativeElement.querySelector('[role=alert]')).not.toBeNull();
    button.click();
    await Promise.resolve();
    expect(navigate).not.toHaveBeenCalled();
    expect(store.createVault).not.toHaveBeenCalled();
    expect(store.createPortfolio).not.toHaveBeenCalled();
    expect(store.updatePortfolio).not.toHaveBeenCalled();
    expect(storageWrite).not.toHaveBeenCalled();
  });

  it('revalidates the address when the selected chain changes', () => {
    const { view, navigate } = setup('ephemeral');
    const button = enter(view, publicAddress);
    const context = view.nativeElement.querySelector('select') as HTMLSelectElement;
    context.value = 'dogecoin:mainnet'; context.dispatchEvent(new Event('change')); view.detectChanges();
    expect(button.disabled).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('accepts a checksummed uppercase Bitcoin Bech32 address without saving', async () => {
    const address = 'BC1QCR8TE4KR609GCAWUTMRZA0J4XV80JY8Z306FYU';
    const { view, navigate, storageWrite, store } = setup('ephemeral');
    const button = enter(view, address);
    expect(button.disabled).toBe(false);
    button.click();
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith(['/portfolio', 'bitcoin', 'mainnet', address]));
    expect(storageWrite).not.toHaveBeenCalled();
    expect(store.createVault).not.toHaveBeenCalled();
    expect(store.createPortfolio).not.toHaveBeenCalled();
    expect(store.updatePortfolio).not.toHaveBeenCalled();
  });

  it.each([
    'bC1QCR8TE4KR609GCAWUTMRZA0J4XV80JY8Z306FYU',
    'BC1QCR8TE4KR609GCAWUTMRZA0J4XV80JY8Z306FYQ',
    '1'.repeat(91),
  ])('rejects mixed-case, checksum and oversized Bitcoin input', async (address) => {
    const { view, navigate, storageWrite } = setup('ephemeral');
    const button = enter(view, address);
    expect(button.disabled).toBe(true);
    await (view.componentInstance as unknown as { save: () => Promise<void> }).save();
    expect(navigate).not.toHaveBeenCalled();
    expect(storageWrite).not.toHaveBeenCalled();
  });

  it.each([
    ['dogecoin', 'DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L'],
    ['zcash', 't1SEgZvXCu3ceE42qrq5pCeSq7HbLjX8NJv'],
  ])('routes the selected %s public address without writes', async (chain, address) => {
    const { view, navigate, storageWrite, store } = setup('ephemeral');
    const context = view.nativeElement.querySelector('select') as HTMLSelectElement;
    context.value = `${chain}:mainnet`; context.dispatchEvent(new Event('change')); view.detectChanges();
    const button = enter(view, address);
    expect(button.disabled).toBe(false);
    button.click();
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith(['/portfolio', chain, 'mainnet', address]));
    expect(storageWrite).not.toHaveBeenCalled();
    expect(store.createPortfolio).not.toHaveBeenCalled();
  });

  it.each([
    ['dogecoin', 'pubkey hash', checkedAddress([0x1e])],
    ['dogecoin', 'script hash starting with 9', checkedAddress([0x16], 20, 0)],
    ['dogecoin', 'script hash starting with A', checkedAddress([0x16], 20, 255)],
    ['zcash', 'transparent pubkey hash', checkedAddress([0x1c, 0xb8])],
    ['zcash', 'transparent script hash', checkedAddress([0x1c, 0xbd])],
  ])('accepts the supported %s %s version and payload', async (chain, _kind, address) => {
    const { view, navigate, storageWrite, store } = setup('ephemeral');
    const context = view.nativeElement.querySelector('select') as HTMLSelectElement;
    context.value = `${chain}:mainnet`; context.dispatchEvent(new Event('change')); view.detectChanges();
    const button = enter(view, address);
    expect(button.disabled).toBe(false);
    button.click();
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith(['/portfolio', chain, 'mainnet', address]));
    expect(storageWrite).not.toHaveBeenCalled();
    expect(store.createVault).not.toHaveBeenCalled();
    expect(store.createPortfolio).not.toHaveBeenCalled();
    expect(store.updatePortfolio).not.toHaveBeenCalled();
  });

  it.each([
    ['dogecoin', 'changed checksum', 'DH5yaieqoZN36fDVciNyRueRGvGLR3mr71'],
    ['zcash', 'changed checksum', 't1SEgZvXCu3ceE42qrq5pCeSq7HbLjX8NJ1'],
    ['dogecoin', 'unsupported D version', checkedAddress([0x1f])],
    ['zcash', 'unsupported t1 version', checkedAddress([0x1c, 0xb9])],
    ['dogecoin', 'short payload', checkedAddress([0x1e], 19)],
    ['dogecoin', 'long payload', checkedAddress([0x1e], 21)],
    ['zcash', 'short payload', checkedAddress([0x1c, 0xb8], 19)],
    ['zcash', 'long payload', checkedAddress([0x1c, 0xb8], 21)],
  ])('rejects %s %s before navigation or persistence', async (chain, _failure, address) => {
    const { view, navigate, storageWrite, store } = setup('ephemeral');
    const context = view.nativeElement.querySelector('select') as HTMLSelectElement;
    context.value = `${chain}:mainnet`; context.dispatchEvent(new Event('change')); view.detectChanges();
    const button = enter(view, address);
    expect(button.disabled).toBe(true);
    // Also enforce the boundary if submit is invoked without using the disabled button.
    await (view.componentInstance as unknown as { save: () => Promise<void> }).save();
    expect(navigate).not.toHaveBeenCalled();
    expect(storageWrite).not.toHaveBeenCalled();
    expect(store.createVault).not.toHaveBeenCalled();
    expect(store.createPortfolio).not.toHaveBeenCalled();
    expect(store.updatePortfolio).not.toHaveBeenCalled();
  });

  it('clears rejected private material from the input and model', () => {
    const { view } = setup('ephemeral');
    enter(view, 'xprv' + '1'.repeat(107));
    expect((view.nativeElement.querySelector('textarea') as HTMLTextAreaElement).value).toBe('');
    expect((view.componentInstance as unknown as { material: string }).material).toBe('');
  });

  it.each([
    ['Create from one address', publicAddress, 'address', 1],
    ['Import an address list', `${publicAddress}\nbc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu`, 'addresses', 2],
    ['Add a Bitcoin watch-only wallet', deriveAccountXpubFromSeed(new Uint8Array(32).fill(1), 'p2wpkh', 0), 'xpub', 1],
  ])('preserves the saved %s path', async (label, material, accountKind, count) => {
    const { view, navigate, store } = setup(undefined, 'unlocked');
    const choice = Array.from(view.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find((button) => button.textContent?.includes(label as string))!;
    choice.click(); view.detectChanges();
    const button = enter(view, material as string);
    expect(button.disabled).toBe(false);
    expect(button.textContent).toContain('Save portfolio');
    button.click();
    await vi.waitFor(() => expect(store.updatePortfolio).toHaveBeenCalledOnce());
    const saved = store.updatePortfolio.mock.calls[0][1]({ accounts: [] });
    expect(saved.accounts).toHaveLength(count as number);
    expect(saved.accounts.every((account: { kind: string }) => account.kind === accountKind)).toBe(true);
    expect(navigate).toHaveBeenCalledWith(['/portfolio/p', 'local-test', 'overview']);
  });

  it('accepts a header CSV list and preserves each public address and label', async () => {
    const { view, navigate, store } = setup(undefined, 'unlocked');
    const choice = Array.from(view.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find((button) => button.textContent?.includes('Import an address list'))!;
    choice.click(); view.detectChanges();
    const button = enter(view, `address,chain,network,label,group\n${publicAddress},bitcoin,mainnet,Legacy fixture,\nbc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu,bitcoin,mainnet,SegWit fixture,`);
    expect(button.disabled).toBe(false);
    button.click();
    await vi.waitFor(() => expect(store.updatePortfolio).toHaveBeenCalledOnce());
    const saved = store.updatePortfolio.mock.calls[0][1]({ accounts: [] });
    expect(saved.accounts.map((account: { name: string; addresses: string[] }) => ({ name: account.name, addresses: account.addresses }))).toEqual([
      { name: 'Legacy fixture', addresses: [publicAddress] },
      { name: 'SegWit fixture', addresses: ['bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'] },
    ]);
    expect(navigate).toHaveBeenCalledWith(['/portfolio/p', 'local-test', 'overview']);
  });
});
