// @vitest-environment jsdom
import 'zone.js';
import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { AddressComponent } from './address.component';

const source=readFileSync('src/app/components/address/address.component.html','utf8');
const start=source.indexOf('<div *ngIf="utxoSourceState === \'complete\' && !reconstructionOffered');
if(start<0)throw Error('Actual independent entry control is missing');
const template=source.slice(start,source.indexOf('</div>',start)+6);
@Component({standalone:true,imports:[CommonModule],template})
class EntryHost {
  readonly control=new AddressComponent(undefined,undefined,undefined,{network:'signet',env:{ROOT_NETWORK:'mainnet'}} as any,undefined,undefined,undefined,undefined,undefined);
  constructor(){this.control.network='signet';this.control.addressString='tb1qpublictestaddress';this.control.address={address:this.control.addressString,is_pubkey:false} as any;
    this.control.isLoadingAddress=false;this.control.utxoSourceState='complete';}
  get utxoSourceState(){return this.control.utxoSourceState;}
  get reconstructionOffered(){return this.control.reconstructionOffered;}
  get canOfferIndependentReconstruction(){return this.control.canOfferIndependentReconstruction;}
  get address(){return this.control.address;}
  offerIndependentReconstruction(){this.control.offerIndependentReconstruction();}
}
describe('actual address opt-in template fragment with real scope controller',()=>{
  beforeAll(()=>TestBed.initTestEnvironment(BrowserDynamicTestingModule,platformBrowserDynamicTesting()));
  afterEach(()=>TestBed.resetTestingModule());
  it('states native completion and opens only on a user click without initiating source IO',()=>{
    const f=TestBed.createComponent(EntryHost);f.detectChanges();const c=f.componentInstance.control,element=f.nativeElement as HTMLElement;
    expect(element.textContent).toContain('The native output read completed');const button=element.querySelector('button');expect(button.disabled).toBe(false);
    expect(c.reconstructionOffered).toBe(false);button.click();f.detectChanges();expect(c.reconstructionOffered).toBe(true);expect(c.utxoSourceState).toBe('complete');expect(element.querySelector('button')).toBeNull();
    c.network='testnet4';c.utxoSourceState='loading';f.detectChanges();expect(c.reconstructionOffered).toBe(false);expect(element.querySelector('button')).toBeNull();
  });
  it('disables actual button during loading or stale validation and never offers another chain',()=>{
    const f=TestBed.createComponent(EntryHost);f.detectChanges();const c=f.componentInstance.control,element=f.nativeElement as HTMLElement;
    c.isLoadingAddress=true;f.detectChanges();expect(element.querySelector('button').disabled).toBe(true);element.querySelector('button').click();expect(c.reconstructionOffered).toBe(false);
    c.isLoadingAddress=false;c.address={...c.address,address:'tb1qother'};f.detectChanges();expect(element.querySelector('button').disabled).toBe(true);
    c.address={...c.address,address:c.addressString};c.network='liquidtestnet';f.detectChanges();expect(element.querySelector('button').disabled).toBe(true);
  });
});
