"""Explicit bounded observer for one private Signet V4 reconstruction handle.
No background polling or automatic retry. Observer budget exhaustion preserves
state; source failures stop for explicit operator action. Native guards unchanged.
"""
from __future__ import annotations
import argparse,datetime,hashlib,json,pathlib,re,time,urllib.request,urllib.error
ORIGIN='http://127.0.0.1:17997/api/v1'
ADDRESS='tb1pvhu96rrd0f3kz8a5l7hdntrfj9vmmfk0tszf4arx2kujs6zz82dqxflggf'
AUDIT=pathlib.Path('C:/universe/mempool/audits/implementation-20261009-api')
SCHEMA='universe-reconstruction-v4-observer-state-v1'
MAX_BYTES=4_000_000
GENESIS='00000008819873e925422c1ff0f99f7cc9bbb232af63a077a480a3633bee1ef6'
def integer(value):return type(value) is int and 0<=value<=1_000_000
def stamp():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def exact_scope(state):
 if state.get('schema')!=SCHEMA or state.get('origin')!=ORIGIN or state.get('address')!=ADDRESS or state.get('network')!='signet':raise ValueError('Observer scope mismatch')
 for field,size in [('releaseSha',40),('configurationSha256',64),('originalAnchorSha256',64)]:
  if not isinstance(state.get(field),str) or not re.fullmatch('[0-9a-f]{'+str(size)+'}',state[field]):raise ValueError('Exact artifact/profile binding required')
 if not re.fullmatch('[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',state.get('sessionId','')) or not integer(state.get('cursor')):raise ValueError('Exact session/cursor required')
 if state.get('pendingCursor') is not None and not integer(state['pendingCursor']):raise ValueError('Invalid pending cursor')
 datetime.datetime.fromisoformat(state['expiresAt'].replace('Z','+00:00'))
def validate_view(view,state=None):
 if view.get('schema')!='universe-address-utxo-reconstruction-v4' or view.get('address')!=ADDRESS or view.get('network')!='signet' or not integer(view.get('cursor')) or view.get('progress',{}).get('pageLimit')!=100:raise ValueError('Reconstruction response context/guard mismatch')
 if view.get('status') not in ['PARTIAL','BLOCKED','CANCELLED','INVALIDATED','COMPLETE_AT_OBSERVED_TIP']:raise ValueError('Unknown reconstruction lifecycle')
 anchor=view.get('confirmedAnchor',{})
 if anchor.get('genesisHash')!=GENESIS or anchor.get('network')!='signet' or not re.fullmatch('[0-9a-f]{64}',anchor.get('sourceId','')):raise ValueError('Original source anchor unavailable')
 if state:
  if view.get('sessionId')!=state['sessionId'] or view.get('expiresAt')!=state['expiresAt'] or {key:anchor.get(key) for key in state['originalAnchor']}!=state['originalAnchor']:raise ValueError('Session lifetime/original anchor changed')
 return view

def validate_inspection(value,state):
 exact_scope(state)
 if value.get('schema')!='universe-address-utxo-reconstruction-inspection-v1' or value.get('sessionId')!=state['sessionId'] or value.get('address')!=ADDRESS or value.get('network')!='signet' or value.get('expiresAt')!=state['expiresAt']:raise ValueError('Inspection identity/lifetime mismatch')
 binding=value.get('binding',{})
 if any(binding.get(k)!=state[k] for k in ['network','releaseSha','configurationSha256']) or binding.get('sourceId')!=state['originalAnchor']['sourceId'] or binding.get('confirmedAnchorSha256')!=state['originalAnchorSha256']:raise ValueError('Inspection artifact/profile/source mismatch')
 if not integer(value.get('cursor')) or type(value.get('busy')) is not bool or 'result' in value or 'items' in value:raise ValueError('Inspection is not bounded state-only metadata')
 if value.get('status') not in ['PARTIAL','BLOCKED','CANCELLED','INVALIDATED','COMPLETE_AT_OBSERVED_TIP']:raise ValueError('Unknown inspection lifecycle')
 checkpoint=value.get('lastSuccessfulObservation',{}).get('checkpoint',{})
 if checkpoint.get('network')!='signet' or checkpoint.get('genesisHash')!=GENESIS:raise ValueError('Inspection checkpoint scope mismatch')
 return value

def resume_cursor(state,inspection):
 validate_inspection(inspection,state)
 if inspection['busy']:raise ValueError('Operation already busy; no second operation admitted')
 pending=state.get('pendingCursor')
 if pending is None:
  if inspection['cursor']!=state['cursor']:raise ValueError('Unexpected progress by another observer')
  return state['cursor']
 if inspection['cursor']==pending:return pending
 if inspection['cursor']==pending+1 and inspection.get('replayCursor')==pending:return pending
 raise ValueError('Pending operation cannot be resumed with an exact retry cursor')

class Transport:
 def request(self,path,method='GET',body=None,timeout=22):
  data=json.dumps(body).encode() if body is not None else b'{}' if method=='POST' else None
  req=urllib.request.Request(ORIGIN+path,data=data,method=method,headers={'Content-Type':'application/json'} if data is not None else {})
  try:
   with urllib.request.urlopen(req,timeout=timeout) as response:status=response.status;raw=response.read(MAX_BYTES+1)
  except urllib.error.HTTPError as error:status=error.code;raw=error.read(MAX_BYTES+1)
  if len(raw)>MAX_BYTES:raise ValueError('Bounded response capacity exceeded')
  return status,json.loads(raw),raw

def rooted_file(path):
 root=AUDIT.resolve();path=pathlib.Path(path);path=(AUDIT/path).absolute() if not path.is_absolute() else path.absolute()
 if path.resolve().parent!=root:raise ValueError('Observer files must be direct audit-root files')
 if path.exists() and (path.lstat().st_nlink>1 or path.is_symlink() or getattr(path.lstat(),'st_file_attributes',0)&1024):raise ValueError('Linked observer file')
 return path

def save(path,state):
 exact_scope(state);raw=(json.dumps(state,indent=2)+'\n').encode()
 if len(raw)>65536:raise ValueError('Bounded observer state exceeded')
 temp=rooted_file(str(path)+'.write')
 with temp.open('xb') as target:target.write(raw)
 temp.replace(path)

def load(path):
 raw=path.read_bytes()
 if len(raw)>65536:raise ValueError('Bounded observer state exceeded')
 state=json.loads(raw);exact_scope(state);return state

def inspection(transport,state,timeout=22):
 from urllib.parse import urlencode
 base='/address/'+ADDRESS+'/utxo-reconstruction/v4/'+state['sessionId']
 return transport.request(base+'?'+urlencode({k:state[k] for k in ['network','releaseSha','configurationSha256']}),timeout=timeout)

def observe(state,transport,steps=1,seconds=600,clock=time.monotonic,persist=lambda _:None):
 exact_scope(state)
 if type(steps) is not int or not 1<=steps<=650 or not 0<seconds<=600:raise ValueError('Bounded observer limits required')
 deadline=clock()+seconds;rows=[];operations=0
 status,meta,raw=inspection(transport,state,min(22,seconds))
 rows.append({'operation':'inspect','status':status,'sha256':hashlib.sha256(raw).hexdigest()})
 if status!=200:return {'outcome':'INSPECTION_UNAVAILABLE_NO_ADVANCE','rows':rows,'operations':0}
 try:cursor=resume_cursor(state,meta)
 except ValueError as error:return {'outcome':'INSPECTION_REJECTED_NO_ADVANCE','reason':str(error),'rows':rows,'operations':0}
 if meta['status'] in ['CANCELLED','INVALIDATED']:return {'outcome':meta['status'],'rows':rows,'operations':0}
 for _ in range(steps):
  if deadline-clock()<22:return {'outcome':'OBSERVER_BUDGET_REACHED_HANDLE_RETAINED','rows':rows,'operations':operations}
  state['pendingCursor']=cursor;persist(state)
  try:
   status,value,raw=transport.request('/address/'+ADDRESS+'/utxo-reconstruction/v4/'+state['sessionId']+'/next','POST',{'cursor':cursor},min(22,deadline-clock()))
  except Exception as error:return {'outcome':'OPERATION_UNAVAILABLE_EXPLICIT_RETRY_REQUIRED','reason':type(error).__name__,'rows':rows,'operations':operations+1}
  operations+=1;rows.append({'operation':'next','inputCursor':cursor,'status':status,'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)})
  if status!=200:return {'outcome':'OPERATION_UNAVAILABLE_EXPLICIT_RETRY_REQUIRED','rows':rows,'operations':operations}
  try:validate_view(value,state)
  except ValueError as error:return {'outcome':'OPERATION_RESPONSE_REJECTED_EXPLICIT_REVIEW_REQUIRED','reason':str(error),'rows':rows,'operations':operations}
  if value['cursor'] not in [cursor,cursor+1] or value['status']=='PARTIAL' and value['cursor']==cursor:return {'outcome':'OPERATION_CURSOR_REJECTED_EXPLICIT_REVIEW_REQUIRED','rows':rows,'operations':operations}
  state['cursor']=value['cursor'];state['pendingCursor']=None;state['lastSuccessfulObservedAt']=value['observedAt'];state['lastResponseSha256']=hashlib.sha256(raw).hexdigest();persist(state)
  if value['status']!='PARTIAL':return {'outcome':value['status'],'rows':rows,'operations':operations,'lastResponse':value,'lastResponseBytes':raw,'largeFullParityQualified':False}
  cursor=value['cursor']
 return {'outcome':'OBSERVER_STEP_BUDGET_REACHED_HANDLE_RETAINED','rows':rows,'operations':operations}

def capture_response_bytes(raw):
 if type(raw) is not bytes or len(raw)>MAX_BYTES:raise ValueError('Bounded raw response bytes required')
 path=rooted_file('reconstruction-v4-response-'+str(time.time_ns())+'.raw')
 with path.open('xb') as target:target.write(raw)
 return {'path':str(path),'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw),'encoding':'exact HTTP response payload bytes; no normalization'}

def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--action',required=True,choices=['start','resume','inspect','cancel']);parser.add_argument('--state',required=True);parser.add_argument('--release');parser.add_argument('--configuration');parser.add_argument('--steps',type=int,default=1);args=parser.parse_args();path=rooted_file(args.state);transport=Transport();report={'classification':'Bounded private Signet observer, not complete large-address/native parity acceptance','startedAt':stamp(),'action':args.action}
 if args.action=='start':
  if path.exists() or not re.fullmatch('[0-9a-f]{40}',args.release or '') or not re.fullmatch('[0-9a-f]{64}',args.configuration or ''):raise ValueError('New state and exact release/configuration required')
  status,value,raw=transport.request('/chain-source/identity')
  if status!=200 or value.get('releaseSha')!=args.release or value.get('configurationSha256')!=args.configuration or value.get('network')!='signet' or value.get('genesisHash')!=GENESIS:raise ValueError('Qualified source identity unavailable')
  status,view,raw=transport.request('/address/'+ADDRESS+'/utxo-reconstruction/v4','POST')
  if status!=200:raise ValueError('Session creation unavailable; no automatic retry')
  validate_view(view);anchor=view['confirmedAnchor'];state={'schema':SCHEMA,'origin':ORIGIN,'address':ADDRESS,'network':'signet','releaseSha':args.release,'configurationSha256':args.configuration,'sessionId':view['sessionId'],'cursor':view['cursor'],'pendingCursor':None,'expiresAt':view['expiresAt'],'originalAnchorSha256':hashlib.sha256(json.dumps(anchor,separators=(',',':'),ensure_ascii=False).encode()).hexdigest(),'originalAnchor':{key:anchor[key] for key in ['sourceId','genesisHash','blockHeight','blockHash','signetChallenge','scriptPubKey']},'lastSuccessfulObservedAt':view['observedAt'],'lastResponseSha256':hashlib.sha256(raw).hexdigest()};save(path,state)
 else:state=load(path)
 if args.action in ['start','resume']:report.update(observe(state,transport,args.steps,persist=lambda s:save(path,s)))
 elif args.action=='inspect':
  status,value,raw=inspection(transport,state);report.update({'outcome':'INSPECTION_ONLY','status':status,'inspection':validate_inspection(value,state) if status==200 else value})
 else:
  status,value,raw=inspection(transport,state)
  if status!=200:raise ValueError('Cannot cancel unverified session binding')
  validate_inspection(value,state);status,value,raw=transport.request('/address/'+ADDRESS+'/utxo-reconstruction/v4/'+state['sessionId'],'DELETE');report.update({'outcome':'EXPLICIT_CANCEL','status':status,'value':value})
 raw=report.pop('lastResponseBytes',None)
 if raw is not None:report['capturedResponseBytes']=capture_response_bytes(raw)
 report['finishedAt']=stamp();report['statePath']=str(path);out=rooted_file('reconstruction-v4-observer-'+str(time.time_ns())+'-receipt.json');out.write_text(json.dumps(report,indent=2)+'\n',encoding='utf8');print(json.dumps({'outcome':report['outcome'],'receipt':str(out),'statePath':str(path)}))
if __name__=='__main__':main()
