// @vitest-environment jsdom
import 'zone.js';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { PortfoliosStore } from '../stores/portfolios.store';
import { PortfolioVaultService } from '../stores/vault.service';
import { PortfolioSettingsComponent } from './portfolio-settings.component';

describe('portfolio backup file selection', () => {
  beforeAll(() => TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()));
  afterEach(() => TestBed.resetTestingModule());

  function setup() {
    const vault = { importEncrypted: vi.fn().mockResolvedValue({ importedRecords: 1 }) };
    const store = { vaultKind: () => 'unlocked', reload: vi.fn().mockResolvedValue(undefined) };
    TestBed.configureTestingModule({ providers: [
      { provide: PortfoliosStore, useValue: store },
      { provide: PortfolioVaultService, useValue: vault },
    ] });
    const view = TestBed.createComponent(PortfolioSettingsComponent);
    view.detectChanges();
    const fileInput = view.nativeElement.querySelector('input[type=file]') as HTMLInputElement;
    const importButton = [...view.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>]
      .find(button => button.textContent?.includes('Validate and import'))!;
    const select = (text: () => Promise<string>) => {
      Object.defineProperty(fileInput, 'files', { configurable: true, value: [{ text }] });
      fileInput.dispatchEvent(new Event('change'));
    };
    return { vault, view, select, importButton };
  }

  it('cannot import a previously selected backup after malformed JSON is selected', async () => {
    const { vault, view, select, importButton } = setup();
    select(async () => JSON.stringify({ previous: 'backup' }));
    await vi.waitFor(() => expect(view.componentInstance.message()).toContain('Backup file loaded'));
    select(async () => '{broken');
    await vi.waitFor(() => expect(view.componentInstance.message()).toContain('not a valid backup'));
    importButton.click();
    expect(vault.importEncrypted).not.toHaveBeenCalled();
  });

  it('clears the previous selection while the replacement file is still loading', async () => {
    const { vault, view, select, importButton } = setup();
    select(async () => JSON.stringify({ previous: 'backup' }));
    await vi.waitFor(() => expect(view.componentInstance.message()).toContain('Backup file loaded'));
    select(() => new Promise<string>(() => undefined));
    importButton.click();
    expect(vault.importEncrypted).not.toHaveBeenCalled();
  });

  it('ignores a previous file that finishes reading after the current selection', async () => {
    const { vault, view, select, importButton } = setup();
    let finishPrevious!: (text: string) => void;
    select(() => new Promise<string>(resolve => { finishPrevious = resolve; }));
    select(async () => JSON.stringify({ current: 'backup' }));
    await vi.waitFor(() => expect(view.componentInstance.message()).toContain('Backup file loaded'));
    finishPrevious(JSON.stringify({ previous: 'backup' }));
    await Promise.resolve();
    importButton.click();
    expect(vault.importEncrypted).toHaveBeenCalledWith({ current: 'backup' }, '');
  });

  it('reports a failed file read and leaves no previous backup available to import', async () => {
    const { vault, view, select, importButton } = setup();
    select(async () => JSON.stringify({ previous: 'backup' }));
    await vi.waitFor(() => expect(view.componentInstance.message()).toContain('Backup file loaded'));
    select(async () => { throw new Error('file read failed'); });
    await vi.waitFor(() => expect(view.componentInstance.message()).toContain('not a valid backup'));
    importButton.click();
    expect(vault.importEncrypted).not.toHaveBeenCalled();
  });
});
