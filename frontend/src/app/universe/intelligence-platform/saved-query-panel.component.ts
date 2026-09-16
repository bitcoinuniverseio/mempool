import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, OnChanges, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { OwnerKeyService } from './owner-key.service';
import { IntelligenceApiService } from './intelligence-api.service';
@Component({selector:'app-saved-query-panel',standalone:true,imports:[CommonModule,FormsModule],template:`
<section class="card mb-4"><div class="card-header"><h2 class="h5">Saved queries</h2></div><div class="card-body">
<p class="small">Saving sends the SQL text to this backend for storage under the current owner key. Saving and loading do not execute SQL.</p>
<label for="savedQueryTitle">Title</label><input id="savedQueryTitle" class="form-control" [(ngModel)]="title" (ngModelChange)="cancelSave()" maxlength="128">
<button class="btn btn-secondary mt-2" (click)="save()" [disabled]="busy || !title.trim() || !sql.trim()">Save current SQL</button>
<button class="btn btn-outline-secondary mt-2" (click)="read(false)" [disabled]="busy">Load saved queries</button>
<p class="text-warning" *ngIf="error">{{ error }}</p><p *ngIf="notice">{{ notice }}</p>
<ul><li *ngFor="let row of rows"><button class="btn btn-link" (click)="load.emit(row.sql)">{{ row.title }}</button></li></ul>
<button *ngIf="cursor" class="btn btn-outline-secondary" (click)="read(true)" [disabled]="busy">Load more saved queries</button>
<p *ngIf="complete">End of this saved-query page sequence.</p>
</div></section>`})
export class SavedQueryPanelComponent implements OnInit,OnDestroy,OnChanges {
 @Input() sql='';@Output() load=new EventEmitter<string>();title='';rows:any[]=[];cursor:string|null=null;complete=false;busy=false;error:string|null=null;notice:string|null=null;
 private request?:Subscription;private saving?:Subscription;private context=new Subscription();private version=0;private destroyed=false;
 constructor(private api:IntelligenceApiService,private state:StateService,private owner:OwnerKeyService,private cdr:ChangeDetectorRef){}
 ngOnInit():void {this.context.add(this.state.networkChanged$?.subscribe(()=>this.reset()));this.context.add(this.owner.key$.subscribe(()=>this.reset()));}
 ngOnChanges():void {this.cancelSave();}
 cancelSave():void {this.saving?.unsubscribe();this.notice=null;this.busy=false;}
 private reset():void {this.version++;this.request?.unsubscribe();this.cancelSave();this.rows=[];this.cursor=null;this.complete=false;this.error=null;this.cdr.markForCheck();}
 private authorized():boolean {if(this.owner.key)return true;this.error='An owner key is required. Configure it in the developer panel.';return false;}
 read(more=false):void {
  if(!this.authorized())return;const cursor=more?this.cursor:undefined;if(more&&!cursor)return;this.request?.unsubscribe();this.saving?.unsubscribe();const version=this.version;this.busy=true;this.error=null;
  if(!more){this.rows=[];this.cursor=null;this.complete=false;}
  this.request=this.api.getSavedQueryPage$(cursor??undefined).subscribe({next:page=>{
   if(this.destroyed||version!==this.version)return;
   const id=/^[0-9a-f-]{36}$/i;
   if(!Array.isArray(page?.saved_queries)||page.saved_queries.length>100||typeof page.complete!=='boolean'||page.next_cursor!==null&&(typeof page.next_cursor!=='string'||!id.test(page.next_cursor))||page.complete!==(page.next_cursor===null)||page.saved_queries.some((row:any)=>!row||typeof row.sql!=='string'||typeof row.title!=='string'||typeof row.query_id!=='string'||!id.test(row.query_id))){this.error='Malformed saved-query page.';this.busy=false;this.cdr.markForCheck();return;}
   this.rows=more?[...this.rows,...page.saved_queries]:page.saved_queries;this.cursor=page.next_cursor;this.complete=page.complete;this.busy=false;this.cdr.markForCheck();
  },error:()=>{this.error='Saved-query source unavailable or authorization rejected.';this.busy=false;this.cdr.markForCheck();}});
 }
 save():void {
  if(!this.authorized())return;const title=this.title.trim(),sql=this.sql,version=this.version;if(!title||!sql.trim())return;this.request?.unsubscribe();this.saving?.unsubscribe();this.busy=true;this.error=null;this.notice=null;
  this.saving=this.api.saveQuery$(title,sql).subscribe({next:row=>{if(this.destroyed||version!==this.version||sql!==this.sql||title!==this.title.trim())return;this.busy=false;if(row?.title!==title||row?.sql!==sql||typeof row?.query_id!=='string')this.error='Saved response does not match the submitted SQL.';else this.notice='Query text stored. No SQL executed.';this.cdr.markForCheck();},error:()=>{this.busy=false;this.error='Saving was not confirmed: source, authorization or quota rejected it.';this.cdr.markForCheck();}});
 }
 ngOnDestroy():void {this.destroyed=true;this.version++;this.request?.unsubscribe();this.saving?.unsubscribe();this.context.unsubscribe();}
}
