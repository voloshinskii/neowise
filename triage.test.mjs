import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

test("POST /api/triage", { timeout: 10_000 }, async (t) => {
  const server = spawn(process.execPath, [fileURLToPath(new URL("./server.mjs", import.meta.url))], {
    env: { ...process.env, PORT: "0" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const stopped = once(server, "exit");
  t.after(async () => {
    server.kill();
    await stopped;
  });

  const output = createInterface({ input: server.stdout });
  const baseUrl = await Promise.race([
    once(output, "line").then(([line]) => line),
    stopped.then(([code]) => assert.fail(`Server exited before listening (code ${code})`)),
  ]);

  async function post(body) {
    const response = await fetch(new URL("/api/triage", baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(1_000),
    });
    return { httpStatus: response.status, body: await response.json() };
  }

  await t.test("rejects invalid and missing input with HTTP 400", async () => {
    for (const input of ["", "{", "null", "{}", '{"text":9}', '{"text":null}', '{"text":""}', '{"text":"  \\n " }']) {
      assert.deepEqual(await post(input), {
        httpStatus: 400,
        body: { status: "invalid_input" },
      }, input);
    }
  });

  await t.test("returns a topic and draft for a valid request", async () => {
    for (const [text, topic] of [
      ["Когда будет доставка?", "delivery"],
      ["Уточните стоимость", "pricing"],
      ["Здравствуйте", "other"],
    ]) {
      assert.deepEqual(await post(JSON.stringify({ text })), {
        httpStatus: 200,
        body: { status: "ready", topic, draft: "Спасибо за обращение. Уточним детали заявки." },
      });
    }
  });

  for (const marker of ["[timeout]", "[error]", "[bad-json]", "[bad-topic]", "[empty-draft]"]) {
    await t.test(`sends ${marker} to manual review`, async () => {
      assert.deepEqual(await post(JSON.stringify({ text: marker })), {
        httpStatus: 200,
        body: { status: "manual_review", topic: null, draft: null },
      });
    });
  }
});
