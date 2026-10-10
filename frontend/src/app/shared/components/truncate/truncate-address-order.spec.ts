// @vitest-environment jsdom
import 'zone.js';
import { CommonModule } from '@angular/common';
import { Component, ɵresolveComponentResources } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { provideRouter, RouterModule } from '@angular/router';
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, expect, it } from 'vitest';
import { TruncateComponent } from './truncate.component';
const html=readFileSync('src/app/shared/components/truncate/truncate.component.html','utf8');
@Component({standalone:true,imports:[CommonModule,RouterModule],template:html})
class RenderedTruncate extends TruncateComponent {constructor(){super('en-US');}}
beforeAll(async()=>{TestBed.initTestEnvironment(BrowserDynamicTestingModule,platformBrowserDynamicTesting());await ɵresolveComponentResources(url=>Promise.resolve(url.endsWith('.html')?html:''));});
afterEach(()=>TestBed.resetTestingModule());
it('retains canonical address order and full accessible value when the first fragment is ellipsized',()=>{
  const address='1Q2TWHE3GMdB6BZKafqwxXtWAWgFt5Jvm3';TestBed.configureTestingModule({providers:[provideRouter([])]});
  const fixture=TestBed.createComponent(RenderedTruncate);fixture.componentInstance.text=address;fixture.componentInstance.lastChars=8;fixture.componentInstance.link=['/address',address];fixture.detectChanges();
  const link=fixture.nativeElement.querySelector('a') as HTMLAnchorElement;
  expect(link.getAttribute('aria-label')).toBe(address);expect(link.title).toBe(address);expect(link.getAttribute('href')).toBe('/address/'+address);
  expect(link.querySelector('.first').textContent+link.querySelector('.last-four').textContent).toBe(address);
});
