// @vitest-environment jsdom
import 'zone.js';
import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, expect, it } from 'vitest';
const html=readFileSync('src/app/components/address/address.component.html','utf8');
const guard=html.match(/<ng-template \[ngIf\]="([^"]*isLoadingAddress[^"]*)">/)?.[1];
// Exercise the actual published-page guard, with a body that would throw if
// the unavailable/null state reached it. Full page/browser review stays separate.
@Component({standalone:true,imports:[CommonModule],template:`<ng-template [ngIf]="${guard}"><span class="address-data">{{ address.address }}</span></ng-template>`})
class RenderedAddressGuard {isLoadingAddress=false;error:unknown=undefined;address:{address:string}|null=null;contextUnavailable=true;}
beforeAll(()=>TestBed.initTestEnvironment(BrowserDynamicTestingModule,platformBrowserDynamicTesting()));afterEach(()=>TestBed.resetTestingModule());
it('does not render/dereference address data for canceled/unavailable or empty scope',()=>{
  expect(guard).toBeDefined();const fixture=TestBed.createComponent(RenderedAddressGuard);expect(()=>fixture.detectChanges()).not.toThrow();expect(fixture.nativeElement.querySelector('.address-data')).toBeNull();
  fixture.componentInstance.contextUnavailable=false;expect(()=>fixture.detectChanges()).not.toThrow();expect(fixture.nativeElement.querySelector('.address-data')).toBeNull();
  fixture.componentInstance.address={address:'accepted'};fixture.detectChanges();expect(fixture.nativeElement.querySelector('.address-data').textContent).toBe('accepted');
});
