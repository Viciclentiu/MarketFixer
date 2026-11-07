const http = require("node:http");

const server = http.createServer((request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  let statusCode = 200;
  let body;

  if (request.method !== "GET") {
    statusCode = 405;
    body = { error: "method not allowed" };
  } else if (path === "/health") {
    body = { status: "ok" };
  } else if (path === "/") {
    body = { service: "MarketFixer" };
  } else {
    statusCode = 404;
    body = { error: "not found" };
  }

  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  response.end(payload);
});

server.listen(8000, "0.0.0.0", () => {
  console.log("Serving on http://0.0.0.0:8000");
});
