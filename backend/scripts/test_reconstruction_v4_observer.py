import importlib.util,pathlib,unittest,json,copy,tempfile,hashlib
spec=importlib.util.spec_from_file_location('observer',pathlib.Path(__file__).parent/'reconstruction-v4-observer.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def state():return {'schema':m.SCHEMA,'origin':m.ORIGIN,'address':m.ADDRESS,'network':'signet','releaseSha':'a'*40,'configurationSha256':'b'*64,'sessionId':'12345678-1234-1234-1234-123456789012','cursor':0,'pendingCursor':None,'expiresAt':'2026-10-09T13:00:00Z','originalAnchorSha256':'d'*64,'originalAnchor':{'sourceId':'c'*64,'genesisHash':m.GENESIS},'lastSuccessfulObservedAt':'2026-10-09T12:00:00Z'}
def metadata(s,cursor=0):return {'schema':'universe-address-utxo-reconstruction-inspection-v1','address':m.ADDRESS,'network':'signet','sessionId':s['sessionId'],'expiresAt':s['expiresAt'],'binding':{**{k:s[k] for k in ['network','releaseSha','configurationSha256']},'sourceId':'c'*64,'confirmedAnchorSha256':'d'*64},'cursor':cursor,'busy':False,'replayCursor':None,'status':'PARTIAL','lastSuccessfulObservation':{'checkpoint':{'network':'signet','genesisHash':m.GENESIS}}}
class Transport:
 def __init__(self,responses):self.responses=responses;self.calls=[]
 def request(self,path,method='GET',body=None,timeout=22):self.calls.append((path,method,body,timeout));status,value=self.responses.pop(0);return status,value,json.dumps(value).encode()
class ObserverTests(unittest.TestCase):
 def test_scope_rejects_foreign_origin_profile_and_boolean_cursor(self):
  for field,value in [('origin','https://external'),('network','mainnet'),('configurationSha256','bad'),('cursor',True)]:
   s=state();s[field]=value
   with self.assertRaises(ValueError):m.exact_scope(s)
 def test_observer_deadline_retains_handle_without_delete_or_source_operation(self):
  s=state();before=copy.deepcopy(s);t=Transport([(200,metadata(s))]);times=iter([0,590]);r=m.observe(s,t,clock=lambda:next(times));self.assertEqual(r['outcome'],'OBSERVER_BUDGET_REACHED_HANDLE_RETAINED');self.assertEqual(s,before);self.assertEqual(len(t.calls),1)
 def test_native_deadline_preserves_exact_pending_cursor_and_never_autoretries(self):
  s=state();t=Transport([(200,metadata(s)),(504,{'phase':'confirmed-history','sourceFailure':{'code':'DEADLINE'}})]);r=m.observe(s,t,steps=650);self.assertEqual(r['operations'],1);self.assertEqual(s['cursor'],0);self.assertEqual(s['pendingCursor'],0);self.assertEqual(len(t.calls),2);self.assertTrue(all(c[1]!='DELETE' for c in t.calls))
 def test_lost_response_replays_original_input_not_next_cursor(self):
  s=state();s['pendingCursor']=0;meta=metadata(s,1);meta['replayCursor']=0;self.assertEqual(m.resume_cursor(s,meta),0);meta['cursor']=2
  with self.assertRaises(ValueError):m.resume_cursor(s,meta)
 def test_busy_foreign_context_and_expiry_slide_never_advance(self):
  for key,value in [('busy',True),('network','mainnet'),('expiresAt','2026-10-09T14:00:00Z')]:
   s=state();meta=metadata(s);meta[key]=value;t=Transport([(200,meta)]);r=m.observe(s,t);self.assertEqual(r['operations'],0);self.assertEqual(len(t.calls),1)
 def test_partial_step_budget_has_no_cancel_and_successful_observation_is_carried(self):
  s=state();v={'schema':'universe-address-utxo-reconstruction-v4','address':m.ADDRESS,'network':'signet','sessionId':s['sessionId'],'expiresAt':s['expiresAt'],'cursor':1,'status':'PARTIAL','progress':{'pageLimit':100},'confirmedAnchor':{**s['originalAnchor'],'network':'signet'},'observedAt':'2026-10-09T12:00:01Z'};t=Transport([(200,metadata(s)),(200,v)]);r=m.observe(s,t);self.assertEqual(r['outcome'],'OBSERVER_STEP_BUDGET_REACHED_HANDLE_RETAINED');self.assertEqual(s['cursor'],1);self.assertIsNone(s['pendingCursor']);self.assertEqual(s['lastSuccessfulObservedAt'],v['observedAt']);self.assertEqual(len(t.calls),2)
 def test_bad_limits_or_tiny_metadata_cannot_qualify(self):
  for steps in [0,651,True]:
   with self.assertRaises(ValueError):m.observe(state(),Transport([]),steps=steps)
  with self.assertRaises(ValueError):m.validate_inspection({},state())
class CaptureTests(unittest.TestCase):
 def test_exact_bytes_exclusive_artifact_and_hash_no_normalization(self):
  from unittest.mock import patch
  original=m.AUDIT
  with tempfile.TemporaryDirectory() as folder:
   m.AUDIT=pathlib.Path(folder);raw=b'{"outputs":["1"]}\r\n'
   try:
    with patch.object(m.time,'time_ns',return_value=1):
     artifact=m.capture_response_bytes(raw);self.assertEqual(pathlib.Path(artifact['path']).read_bytes(),raw);self.assertEqual(artifact['sha256'],hashlib.sha256(raw).hexdigest());self.assertEqual(artifact['bytes'],len(raw))
     with self.assertRaises(FileExistsError):m.capture_response_bytes(raw)
   finally:m.AUDIT=original
 def test_raw_capacity_wrong_type_and_external_path_are_rejected(self):
  with self.assertRaises(ValueError):m.capture_response_bytes(b'x'*(m.MAX_BYTES+1))
  with self.assertRaises(ValueError):m.capture_response_bytes('text')
  with self.assertRaises(ValueError):m.rooted_file('../escape.raw')
if __name__=='__main__':unittest.main()
