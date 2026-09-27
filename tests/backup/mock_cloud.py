# Mock: Google OAuth token + Drive v3 (folder, list, resumable upload, download, delete) + Supabase Storage
import json, re, sys, threading, uuid, urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
files = {}      # id -> {name, parents, mimeType, data}
sessions = {}   # sid -> {meta, size, data}
storage = {('evidence', '2570/2/1.1/a.pdf'): b'%PDF evidence', ('public-images', 'news/u1/n.webp'): b'RIFFwebp', ('documents', 'all/d.pdf'): b'%PDF doc'}
uploaded = {}
log = []
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def body(self):
        n = int(self.headers.get('Content-Length') or 0); return self.rfile.read(n) if n else b''
    def send(self, code, obj=None, headers=None, raw=None):
        data = raw if raw is not None else (json.dumps(obj).encode() if obj is not None else b'')
        self.send_response(code)
        for k, v in (headers or {}).items(): self.send_header(k, v)
        self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)
    def auth_ok(self): return self.headers.get('Authorization') == 'Bearer AT'
    def do_POST(self):
        u = urllib.parse.urlparse(self.path); b = self.body()
        if u.path == '/token':
            f = urllib.parse.parse_qs(b.decode());
            return self.send(200, {'access_token': 'AT'}) if f.get('refresh_token') == ['RT'] else self.send(400, {'error': 'invalid_grant'})
        if u.path.startswith('/storage/v1/object/'):
            if self.headers.get('apikey') != 'sb_secret_test': return self.send(401, {'error': 'bad key'})
            bucket, name = u.path[len('/storage/v1/object/'):].split('/', 1)
            uploaded[(bucket, urllib.parse.unquote(name))] = (b, self.headers.get('Content-Type'), self.headers.get('x-upsert'))
            return self.send(200, {'Key': name})
        if not self.auth_ok(): return self.send(401, {})
        if u.path == '/drive/v3/files':
            m = json.loads(b); fid = uuid.uuid4().hex[:10]; files[fid] = {**m, 'data': b''}; return self.send(200, {'id': fid})
        if u.path == '/upload/drive/v3/files':
            sid = uuid.uuid4().hex; sessions[sid] = {'meta': json.loads(b), 'size': int(self.headers['X-Upload-Content-Length']), 'data': b''}
            return self.send(200, {}, {'Location': f'http://localhost:{PORT}/session/{sid}'})
        self.send(404, {})
    def do_PUT(self):
        u = urllib.parse.urlparse(self.path); b = self.body()
        sid = u.path.split('/')[-1]; s = sessions[sid]; s['data'] += b; log.append(('chunk', len(b), self.headers['Content-Range']))
        if len(s['data']) < s['size']: return self.send(308, None, {'Range': f"bytes=0-{len(s['data']) - 1}"})
        fid = uuid.uuid4().hex[:10]; files[fid] = {**s['meta'], 'data': s['data']}; return self.send(200, {'id': fid})
    def do_DELETE(self):
        fid = self.path.split('/')[-1]; files.pop(fid, None); log.append(('delete', fid)); self.send(204)
    def do_GET(self):
        u = urllib.parse.urlparse(self.path); qs = urllib.parse.parse_qs(u.query)
        if u.path == '/state': return self.send(200, {'files': {k: {'name': v['name'], 'size': len(v['data'])} for k, v in files.items() if v.get('mimeType') != 'application/vnd.google-apps.folder'}, 'uploaded': {f'{k[0]}/{k[1]}': [len(v[0]), v[1], v[2]] for k, v in uploaded.items()}, 'log': log[-50:]})
        if u.path == '/seed':   # add fake old backups
            fold = [k for k, v in files.items() if v.get('mimeType') == 'application/vnd.google-apps.folder'][0]
            for n in qs['n'][0].split(','): files[uuid.uuid4().hex[:10]] = {'name': n, 'parents': [fold], 'data': b'x'}
            return self.send(200, {})
        if u.path.startswith('/storage/v1/object/authenticated/'):
            if self.headers.get('apikey') != 'sb_secret_test' or self.headers.get('Authorization') != 'Bearer sb_secret_test': return self.send(401, {})
            bucket, name = u.path[len('/storage/v1/object/authenticated/'):].split('/', 1)
            d = storage.get((bucket, urllib.parse.unquote(name)))
            return self.send(200, raw=d) if d is not None else self.send(404, {'error': 'not found'})
        if not self.auth_ok(): return self.send(401, {})
        m = re.match(r'/drive/v3/files/(\w+)$', u.path)
        if m and qs.get('alt') == ['media']: return self.send(200, raw=files[m.group(1)]['data'])
        if u.path == '/drive/v3/files':
            q = qs['q'][0]
            if 'mimeType=' in q:
                name = re.search(r"name='([^']*)'", q).group(1)
                res = [{'id': k} for k, v in files.items() if v.get('name') == name and v.get('mimeType') == 'application/vnd.google-apps.folder']
            else:
                par = re.search(r"'(\w+)' in parents", q).group(1)
                res = sorted([{'id': k, 'name': v['name'], 'size': str(len(v['data']))} for k, v in files.items() if par in v.get('parents', [])], key=lambda x: x['name'])
            return self.send(200, {'files': res})
        self.send(404, {})
PORT = int(sys.argv[1])
ThreadingHTTPServer(('localhost', PORT), H).serve_forever()
