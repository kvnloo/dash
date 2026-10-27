import http.server, os, sys
from pathlib import Path
class Handler(http.server.SimpleHTTPRequestHandler):
 def do_GET(self):
  if not Path(self.translate_path(self.path)).is_file() and not self.path.endswith('/'):
   self.path='/index.html'
  super().do_GET()
os.chdir(sys.argv[1])
http.server.ThreadingHTTPServer(('127.0.0.1', int(sys.argv[2])), Handler).serve_forever()
