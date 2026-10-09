import importlib.util,pathlib,unittest,json,http.client,http.server,threading,tempfile,gzip,time,base64
spec=importlib.util.spec_from_file_location('relay',pathlib.Path(__file__).with_name('shared-bitcoin-rpc-relay.py'));relay=importlib.util.module_from_spec(spec);spec.loader.exec_module(relay)
class Tests(unittest.TestCase):
 def setup_servers(self,mode='normal'):
  self.mode=mode;self.received=0;self.cookie=tempfile.TemporaryDirectory();p=pathlib.Path(self.cookie.name)/'.cookie';p.write_text('__cookie__:fixture');p.chmod(0o600)
  parent=self
  class Upstream(http.server.BaseHTTPRequestHandler):
   def log_message(self,*a):pass
   def do_POST(self):
    parent.received+=1
    n=int(self.headers['Content-Length']);v=json.loads(self.rfile.read(n));data=json.dumps({'id':v['id'],'result':'é'*40000}).encode()
    if parent.mode=='lateheaders':time.sleep(.2)
    self.send_response(200)
    if parent.mode=='encoding':self.send_header('Content-Encoding','br')
    if parent.mode!='streamed':self.send_header('Content-Length',str(3000 if parent.mode=='declared' else len(data)+(10 if parent.mode=='truncated' else 0)))
    self.end_headers()
    try:
     if parent.mode=='trickle':
      for i in range(20):self.wfile.write(data[i:i+1]);self.wfile.flush();time.sleep(.01)
     else:self.wfile.write(data)
    except OSError:pass
  self.up=http.server.ThreadingHTTPServer(('127.0.0.1',0),Upstream);self.up.daemon_threads=True
  self.server=relay.Relay(('127.0.0.1',0),{'client_user':'fixture','client_password':'fixture','namespace_cookie':False,'cookie_path':str(p),'upstream_port':self.up.server_port,'upstream_timeout':.05 if mode in ['lateheaders','trickle'] else 1})
  for s in [self.up,self.server]:threading.Thread(target=s.serve_forever,daemon=True).start()
 def tearDown(self):
  for name in ['server','up']:
   s=getattr(self,name,None)
   if s:s.shutdown();s.server_close()
  if hasattr(self,'cookie'):self.cookie.cleanup()
 def request(self,encoding=None,auth=True,method='getblockhash',body=None):
  c=http.client.HTTPConnection('127.0.0.1',self.server.server_port,timeout=2);headers={'Content-Type':'application/json'}
  if auth:headers['Authorization']='Basic '+base64.b64encode(b'fixture:fixture').decode()
  if encoding is not None:headers['Accept-Encoding']=encoding
  c.request('POST','/',body or json.dumps({'id':'fixture','method':method,'params':[]}),headers);r=c.getresponse();b=r.read();status=r.status;enc=r.getheader('Content-Encoding');c.close();return status,enc,b
 def test_gzip_and_identity_negotiate_without_changing_payload(self):
  self.setup_servers();a,e,b=self.request('gzip');self.assertEqual((a,e),(200,'gzip'));decoded=json.loads(gzip.decompress(b));self.assertEqual(decoded['result'],'é'*40000)
  for header in [None,'gzip;q=0','br','gzip;q=NaN','gzip;q=2']:
   a,e,b=self.request(header);self.assertEqual((a,e),(200,None));self.assertEqual(json.loads(b),decoded)
 def test_auth_and_method_scope_guards(self):
  self.setup_servers();self.assertEqual(self.request(auth=False)[0],401);self.assertEqual(self.request(method='walletpassphrase')[0],403);self.assertEqual(self.received,0)
 def test_upstream_declared_and_streamed_bounds(self):
  original=relay.MAX_RESPONSE;relay.MAX_RESPONSE=1024
  try:
   self.setup_servers('declared');self.assertEqual(self.request()[0],502)
   self.mode='streamed';self.assertEqual(self.request()[0],502)
  finally:relay.MAX_RESPONSE=original
 def test_whole_upstream_deadline_covers_headers_and_trickling_body(self):
  for mode in ['lateheaders','trickle']:
   self.setup_servers(mode);t=time.monotonic();self.assertEqual(self.request()[0],502);self.assertLess(time.monotonic()-t,.7);self.tearDown();del self.server;del self.up;del self.cookie
 def test_unsupported_upstream_encoding_is_rejected_without_retry(self):
  self.setup_servers('encoding');self.assertEqual(self.request('gzip')[0],502);self.assertEqual(self.received,1)
 def test_incomplete_upstream_frame_is_unavailable(self):
  self.setup_servers('truncated');self.assertEqual(self.request()[0],502)
 def test_request_byte_and_json_bounds(self):
  self.setup_servers();self.assertEqual(self.request(body='[')[0],400);self.assertEqual(self.request(body='x'*(relay.MAX_REQUEST+1))[0],400);self.assertEqual(self.received,0)
if __name__=='__main__':unittest.main()
