import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { classify } from "./mock-ai.mjs";

const html = await readFile(new URL("./index.html", import.meta.url));
const topics = new Set(["delivery", "pricing", "other"]);
const modelTimeoutMs = 300;

function isNonBlankString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function handleTriage(request, response) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  let input;
  try {
    input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return json(response, 400, { status: "invalid_input" });
  }
  if (!isNonBlankString(input?.text)) {
    return json(response, 400, { status: "invalid_input" });
  }

  const result = await getTriage(input.text);
  return json(response, 200, result ?? { status: "manual_review", topic: null, draft: null });
}

async function getTriage(text) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => {
      resolve(null);
      controller.abort();
    }, modelTimeoutMs);
  });

  try {
    const output = await Promise.race([classify(text, { signal: controller.signal }), deadline]);
    if (typeof output !== "string") return null;
    const result = JSON.parse(output);
    if (!topics.has(result?.topic) || !isNonBlankString(result.draft)) return null;
    return { status: "ready", topic: result.topic, draft: result.draft };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(html);
    return;
  }
  if (request.method !== "POST" || request.url !== "/api/triage") {
    return json(response, 404, { status: "not_found" });
  }
  try {
    await handleTriage(request, response);
  } catch {
    json(response, 500, { status: "server_error" });
  }
});

server.listen(Number(process.env.PORT || 3000), "127.0.0.1", () => {
  console.log(`http://127.0.0.1:${server.address().port}`);
});
