import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class RequestHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            status = 200
            body = {"status": "ok"}
        elif self.path == "/":
            status = 200
            body = {"service": "MarketFixer"}
        else:
            status = 404
            body = {"error": "not found"}

        payload = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", 8000), RequestHandler)
    print("Serving on http://0.0.0.0:8000")
    server.serve_forever()
