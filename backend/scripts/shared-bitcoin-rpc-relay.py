"""Loopback RPC relay for the existing node. Installation awaits authorization.

Protected JSON settings: client_user/client_password, cookie_path, upstream_port.
cookie_path can be relative to /proc/<bitcoin-reindex MainPID>/root. No secrets,
requests, transaction bodies, or upstream diagnostics are written to logs.
"""
import argparse,base64,hmac,http.client,json,pathlib,subprocess,time,gzip,math,threading,socket
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer

ALLOWED=frozenset(('getblockchaininfo getnetworkinfo getindexinfo getblockcount '
 'getbestblockhash getblockhash getblockheader getblock getrawtransaction '
 'gettxout getmempoolinfo getrawmempool getmempoolentry getmempoolancestors '
 'getmempooldescendants estimatesmartfee getchaintips getdifficulty '
 'getconnectioncount uptime getdescriptorinfo deriveaddresses '
 'getblockfilter gettxoutproof verifytxoutproof sendrawtransaction getzmqnotifications getblockstats getnetworkhashps validateaddress').split())
MAX_REQUEST=4*1024*1024
MAX_RESPONSE=64*1024*1024

def accepts_gzip(value):
 for entry in value.lower().split(','):
  parts=[x.strip() for x in entry.split(';')]
  if parts[0]!='gzip':continue
  quality=1.0
  for option in parts[1:]:
   if option.startswith('q='):
    try:quality=float(option[2:])
    except ValueError:quality=0
  if math.isfinite(quality) and 0<quality<=1:return True
 return False

def bounded_upstream_body(connection,response,deadline):
 declared=response.getheader('Content-Length')
 if declared is not None and (not declared.isdecimal() or int(declared)>MAX_RESPONSE):raise ValueError('Response bound')
 chunks=[];size=0
 while True:
  remaining=deadline-time.monotonic()
  if remaining<=0:raise TimeoutError('Response deadline')
  if connection.sock:connection.sock.settimeout(remaining)
  chunk=response.read1(min(65536,MAX_RESPONSE+1-size))
  if not chunk:break
  size+=len(chunk)
  if size>MAX_RESPONSE:raise ValueError('Response bound')
  chunks.append(chunk)
 if time.monotonic()>=deadline:raise TimeoutError('Response deadline')
 if declared is not None and size!=int(declared):raise ValueError('Incomplete response')
 return b''.join(chunks)


class Relay(ThreadingHTTPServer):
 daemon_threads=True
 def handle_error(self,request,client_address):pass
 def __init__(self,address,settings):
  assert address[0]=='127.0.0.1','Relay must bind loopback only'
  self.settings=settings
  self.client_auth='Basic '+base64.b64encode((settings['client_user']+':'+settings['client_password']).encode()).decode()
  super().__init__(address,Handler)
 def upstream_auth(self):
  settings=self.settings
  if settings.get('namespace_cookie',True):
   pid=int(subprocess.check_output(['systemctl','show','bitcoin-reindex.service','--value','-p','MainPID'],text=True,timeout=5).strip())
   if pid<=0:raise RuntimeError('Canonical node unavailable')
   path=pathlib.Path('/proc')/str(pid)/'root'/settings['cookie_path'].lstrip('/')
  else:path=pathlib.Path(settings['cookie_path'])
  cookie=path.read_text().strip()
  if ':' not in cookie:raise RuntimeError('Cookie unavailable')
  return 'Basic '+base64.b64encode(cookie.encode()).decode()

class Handler(BaseHTTPRequestHandler):
 protocol_version='HTTP/1.1'
 def log_message(self,*args):pass
 def reply(self,status,payload,deadline=None):
  data=payload if isinstance(payload,bytes) else json.dumps(payload).encode()
  if not data.endswith(b'\n') and len(data)<MAX_RESPONSE:data+=b'\n'
  if status==200 and len(data)>=65536 and accepts_gzip(self.headers.get('Accept-Encoding','')):
   data=gzip.compress(data,compresslevel=1)
   encoded=True
   if len(data)>MAX_RESPONSE:raise ValueError('Wire response bound')
  else:encoded=False
  if deadline is not None and time.monotonic()>=deadline:raise TimeoutError('Response deadline')
  self.send_response(status);self.send_header('Content-Type','application/json')
  if encoded:self.send_header('Content-Encoding','gzip');self.send_header('Vary','Accept-Encoding')
  self.send_header('Content-Length',str(len(data)))
  self.end_headers();self.wfile.write(data)
 def do_POST(self):
  def stop_request():
   try:self.connection.shutdown(socket.SHUT_RDWR)
   except OSError:pass
  timer=threading.Timer(120,stop_request);timer.daemon=True;timer.start()
  try:self.relay_POST()
  finally:timer.cancel()
 def relay_POST(self):
  self.connection.settimeout(120)
  if not hmac.compare_digest(self.headers.get('Authorization',''),self.server.client_auth):
   self.reply(401,{'error':'Client authentication required'});return
  if self.path!='/':self.reply(404,{'error':'RPC path unavailable'});return
  try:
   lengths=self.headers.get_all('Content-Length') or []
   if len(lengths)!=1 or not lengths[0].isdecimal() or self.headers.get('Transfer-Encoding') is not None:raise ValueError('Request framing')
   length=int(lengths[0])
   if not 0<length<=MAX_REQUEST:raise ValueError('Request length')
   body=self.rfile.read(length)
   if len(body)!=length:raise ValueError('Incomplete request')
   request=json.loads(body)
   batch=request if isinstance(request,list) else [request]
   if not batch or any(not isinstance(x,dict) or not (x.get('method') in ALLOWED or (x.get('method')=='help' and x.get('params')==['help'])) for x in batch):
    self.reply(403,{'error':'RPC method outside indexer relay scope'});return
  except (ValueError,TypeError):self.reply(400,{'error':'Invalid RPC request'});return
  connection=None;upstream_timer=None;upstream_socket=None
  try:
   timeout=float(self.server.settings.get('upstream_timeout',120))
   if not math.isfinite(timeout) or not 0<timeout<=120:raise ValueError('Timeout configuration')
   deadline=time.monotonic()+timeout
   connection=http.client.HTTPConnection('127.0.0.1',int(self.server.settings.get('upstream_port',8332)),timeout=timeout)
   def stop_upstream():
    target=upstream_socket or connection.sock
    if target:
     try:target.shutdown(socket.SHUT_RDWR)
     except OSError:pass
   upstream_timer=threading.Timer(timeout,stop_upstream);upstream_timer.daemon=True;upstream_timer.start()
   auth=self.server.upstream_auth()
   if time.monotonic()>=deadline:raise TimeoutError('Response deadline')
   connection.request('POST','/',body,{'Authorization':auth,'Content-Type':'application/json'})
   upstream_socket=connection.sock
   remaining=deadline-time.monotonic()
   if remaining<=0:raise TimeoutError('Response deadline')
   if connection.sock:connection.sock.settimeout(remaining)
   response=connection.getresponse()
   if str(response.getheader('Content-Encoding') or 'identity').strip().lower()!='identity':raise ValueError('Unsupported canonical encoding')
   data=bounded_upstream_body(connection,response,deadline)
   if response.status==401:self.reply(502,{'error':'Canonical node authentication unavailable'})
   else:self.reply(response.status,data,deadline)
  except Exception:self.reply(502,{'error':'Canonical node temporarily unavailable'})
  finally:
   if upstream_timer:upstream_timer.cancel()
   if connection:connection.close()

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--settings',required=True);parser.add_argument('--port',type=int,default=18332)
 args=parser.parse_args();path=pathlib.Path(args.settings)
 assert path.stat().st_mode&0o077==0,'Settings must be private'
 settings=json.loads(path.read_text());Relay(('127.0.0.1',args.port),settings).serve_forever()