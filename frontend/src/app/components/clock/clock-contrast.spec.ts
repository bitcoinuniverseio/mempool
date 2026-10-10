import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
it('keeps the actual Clock height colors above 4.5 contrast over every possible map background',()=>{
  const scss=readFileSync('src/app/components/clock/clock.component.scss','utf8');const height=scss.match(/\.block-height\s*\{([\s\S]*?)\n\s*\}/)?.[1];
  expect(height).toBeDefined();let hex=height.match(/color:\s*#([a-f0-9]+);/)?.[1];
  if(hex?.length===3) {hex=hex.split('').map(channel=>channel+channel).join('');}
  const foreground=hex?.match(/.{2}/g)?.map(channel=>parseInt(channel,16)/255);
  const rgba=height.match(/background:\s*rgba\(\s*([0-9.]+),\s*([0-9.]+),\s*([0-9.]+),\s*([0-9.]+)\)/)?.slice(1).map(Number);
  expect(foreground).toHaveLength(3);expect(rgba).toHaveLength(4);
  expect([...foreground,...rgba].every(Number.isFinite)).toBe(true);expect(rgba[3]).toBeGreaterThanOrEqual(0);expect(rgba[3]).toBeLessThanOrEqual(1);
  const luminance=(rgb:number[]):number=>rgb.map(channel=>channel<=0.04045?channel/12.92:((channel+0.055)/1.055)**2.4).reduce((sum,channel,index)=>sum+channel*[0.2126,0.7152,0.0722][index],0);
  const foregroundLuminance=luminance(foreground);
  const composite=(underlying:number):number[]=>rgba.slice(0,3).map(channel=>channel/255*rgba[3]+underlying*(1-rgba[3]));
  const low=luminance(composite(0));const high=luminance(composite(1));
  const ratio=(background:number):number=>(Math.max(background,foregroundLuminance)+0.05)/(Math.min(background,foregroundLuminance)+0.05);
  // Compositing is monotone. If the foreground falls inside the possible
  // background luminance interval, some map color can yield contrast1.
  const worst=foregroundLuminance>=low&&foregroundLuminance<=high?1:Math.min(ratio(low),ratio(high));
  expect(worst).toBeGreaterThanOrEqual(4.5);
});
