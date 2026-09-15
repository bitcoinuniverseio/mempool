import {Component,OnDestroy} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {Subscription} from 'rxjs';
import {StateService} from '@app/services/state.service';
import {sha256} from '@noble/hashes/sha256';
import {bytesToHex} from '@noble/hashes/utils';
import {OffchainApiService} from './offchain.service';
import {looksSecretLike} from '../command-center/command-candidates';
const fields=new Set(['signature_scheme','schema_version','protocol','operator_public_key','display_name','networks','endpoints','supported_versions','backup_transaction_policy','signature_count_endpoint','effective_from','expires_at','nonce','signature']);
export function manifestHashes(m:any):{manifest_digest:string;input_digest:string} {
 const sorted:any={};for(const key of Object.keys(m).sort())sorted[key]=m[key];
 const digest=(v:any)=>bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(v))));
 const input_digest=digest(sorted);delete sorted.signature;return {input_digest,manifest_digest:digest(sorted)};
}
export function publicManifest(text:string):any {
 if(new TextEncoder().encode(text).length>65536)throw Error('Manifest exceeds64KiB.');
 const m=JSON.parse(text);if(!m||typeof m!=='object'||Array.isArray(m)||Object.keys(m).some(k=>!fields.has(k)))throw Error('Only public manifest fields are accepted.');
 if(!['schnorr','ecdsa'].includes(m.signature_scheme)||!/^0[23][0-9a-fA-F]{64}$/.test(m.operator_public_key)||!/^[0-9a-fA-F]{128}$/.test(m.signature)||typeof m.protocol!=='string'||!m.protocol.trim())throw Error('Declare Schnorr or ECDSA, compressed public key, compact signature and protocol.');
 if(typeof m.effective_from!=='string'||typeof m.expires_at!=='string'||!Number.isFinite(Date.parse(m.effective_from))||!Number.isFinite(Date.parse(m.expires_at)))throw Error('Explicit validity timestamps required.');
 function check(v:any,depth=0):void {if(depth>8)throw Error('Manifest nesting exceeds limit.');if(typeof v==='string'&&looksSecretLike(v))throw Error('Key-shaped material is not accepted.');if(v&&typeof v==='object')for(const [key,value]of Object.entries(v)){if(/secret|password|token|cookie|private|seed|mnemonic/i.test(key))throw Error('Secret fields are not accepted.');check(value,depth+1);}}
 check(m);
 for(const value of [...Object.values(m.endpoints||{}),m.signature_count_endpoint].filter(Boolean)){if(typeof value!=='string')throw Error('Endpoint must be public URL.');const u=new URL(value);if(u.username||u.password||u.search||u.hash)throw Error('Endpoint credentials and query material are not accepted.');}
 return m;
}
@Component({selector:'app-public-manifest',standalone:true,imports:[CommonModule,FormsModule],template:`<section class="card p-3 my-3"><h2>Verify public operator manifest signature</h2><p>This sends the supplied public manifest to this explorer's API. It does not contact operator endpoints. Do not paste secrets. Nothing is saved by this form.</p><p>The signed digest sorts top-level keys except signature, preserves nested key order, serializes compact JSON and hashes with SHA256. Signature validity does not authenticate the supplied key as an operator.</p><label>Public manifest JSON<textarea class="form-control" rows="7" [(ngModel)]="text" (ngModelChange)="clear()"></textarea></label><button class="btn btn-primary" (click)="verify()" [disabled]="busy">Verify signature</button><p *ngIf="error" role="alert">{{error}}</p><div *ngIf="report"><p>Signature: {{report.signature_valid===true?'Valid':'Invalid'}}</p><p>Signature and validity interval: {{report.verified===true?'Valid':'Not valid'}}</p><p>Operator identity: Unauthenticated</p><p>{{report.verification_scope}}</p></div></section>`})
export class PublicManifestComponent implements OnDestroy {
 text='';busy=false;error:string|null=null;report:any=null;private request?:Subscription;private context:Subscription;private revision=0;private destroyed=false;
 constructor(private api:OffchainApiService,state:StateService){this.context=state.networkChanged$.subscribe(()=>this.clear());}
 clear():void {this.revision++;this.request?.unsubscribe();this.report=null;this.error=null;this.busy=false;}
 ngOnDestroy():void {this.destroyed=true;this.context.unsubscribe();this.clear();this.text='';}
 verify():void {if(this.destroyed)return;this.clear();let payload:any;try{payload=publicManifest(this.text);}catch{this.error='Invalid public manifest fields, signature context or secret-shaped material.';return;}this.busy=true;const revision=this.revision;const hashes=manifestHashes(payload);
 this.request=this.api.verifyManifest$(payload).subscribe({next:r=>{if(revision!==this.revision||this.destroyed)return;this.busy=false;if(typeof r?.signature_valid!=='boolean'||typeof r?.verified!=='boolean'||r.operator_authenticated!==null||typeof r.verification_scope!=='string'||r.declared_scheme!==payload.signature_scheme||r.manifest_digest!==hashes.manifest_digest||r.input_digest!==hashes.input_digest||(r.scheme!==payload.signature_scheme&&!(r.signature_valid===false&&r.scheme===null))||(r.verified===true&&r.signature_valid!==true)){this.error='Unsupported manifest verification response.';return;}this.report=r;},error:()=>{if(revision!==this.revision||this.destroyed)return;this.busy=false;this.error='Manifest verification unavailable; no signature verdict established.';}});
 }
}
