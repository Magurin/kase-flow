import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import ts from "typescript";
import { createReadCache } from "../server/read-cache.mjs";
import handler from "../api/state.mjs";
import { selectedIssue } from "../api/_shared.mjs";
import { publicIssues } from "../api/_public-data.mjs";

test("Vercel functions load without experimental CommonJS require(ESM)", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--no-experimental-require-module",
      "--input-type=module",
      "-e",
      "await import('./api/state.mjs'); await import('./api/workspace.mjs'); await import('./api/transaction/[signature].mjs')",
    ],
    {
      cwd: new URL("../", import.meta.url),
      encoding: "utf8",
      windowsHide: true,
    },
  );
  assert.equal(result.status, 0, result.stderr);
});

test("read cache isolates issues, coalesces requests, expires, and recovers after failure", async () => {
  let now = 0,
    calls = 0,
    resolve;
  const read = createReadCache(10, () => now);
  const a = read("a", () => {
    calls++;
    return new Promise((done) => {
      resolve = done;
    });
  });
  const duplicate = read("a", () => assert.fail("Duplicate read"));
  assert.equal(await read("b", () => "B"), "B");
  resolve("A");
  assert.deepEqual(await Promise.all([a, duplicate]), ["A", "A"]);
  assert.equal(calls, 1);
  assert.equal(await read("a", () => "wrong"), "A");
  now = 11;
  await assert.rejects(
    read("a", () => {
      throw Error("RPC down");
    }),
  );
  assert.equal(await read("a", () => "fresh"), "fresh");
});

test("issue selection rejects unknown IDs and public API denies mutations without contacting RPC", async () => {
  const [a, b] = publicIssues;
  assert.equal(
    selectedIssue({ url: `/api/state?issue=${b.config.state}`, headers: {} })
      .config.state,
    b.config.state,
  );
  assert.equal(
    selectedIssue({
      url: "/api/state",
      headers: { "x-instrument-id": a.config.state },
    }).config.state,
    a.config.state,
  );
  assert.throws(() =>
    selectedIssue({ url: "/api/state?issue=unknown", headers: {} }),
  );
  const response = {
    headers: {},
    statusCode: 200,
    setHeader(k, v) {
      this.headers[k] = v;
    },
    status(n) {
      this.statusCode = n;
      return this;
    },
    json(v) {
      this.body = v;
    },
  };
  await handler({ method: "POST" }, response);
  assert.equal(response.statusCode, 403);
  assert.equal(response.headers["Cache-Control"], "no-store");
  await handler(
    { method: "GET", url: "/api/state?issue=unknown", headers: {} },
    response,
  );
  assert.equal(response.statusCode, 404);
  assert.equal(response.headers["Cache-Control"], "no-store");
});

test("client handles platform HTML/text errors without exposing a JSON parser exception", async () => {
  const source = fs.readFileSync(
    new URL("../src/http.ts", import.meta.url),
    "utf8",
  );
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const { readJson, ApiError } = await import(
    `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
  );
  await assert.rejects(
    readJson(new Response("A server error has occurred", { status: 500 })),
    (e) =>
      e instanceof ApiError &&
      e.status === 500 &&
      !e.message.includes("Unexpected"),
  );
  await assert.rejects(
    readJson(
      new Response(JSON.stringify({ error: "Выпуск не найден" }), {
        status: 404,
      }),
    ),
    /Выпуск не найден/,
  );
  assert.deepEqual(await readJson(new Response('{"ok":true}')), { ok: true });
});
