"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

async function main() {
  const sharedDir = path.join(__dirname, "supabase", "functions", "_shared");
  const moduleUrl = pathToFileURL(path.join(sharedDir, "request-body.mjs")).href;
  const { readJsonObjectLimited } = await import(moduleUrl);
  const encoder = new TextEncoder();
  const limit = 64;

  function requestFromChunks(chunks, headers = new Headers()) {
    return {
      headers,
      body: new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk);
          controller.close();
        }
      })
    };
  }

  function bytes(value) {
    return encoder.encode(typeof value === "string" ? value : JSON.stringify(value));
  }

  const validPayload = { scope: "modo", password: "synthetic-test" };
  assert.deepEqual(
    await readJsonObjectLimited(requestFromChunks([bytes(validPayload)]), limit),
    validPayload
  );

  const exactText = JSON.stringify({ x: "a".repeat(limit - Buffer.byteLength('{"x":""}')) });
  const exactBytes = bytes(exactText);
  assert.equal(exactBytes.byteLength, limit);
  assert.equal(
    (await readJsonObjectLimited(requestFromChunks([exactBytes]), limit)).x.length,
    limit - Buffer.byteLength('{"x":""}')
  );
  assert.deepEqual(
    await readJsonObjectLimited(
      requestFromChunks([exactBytes], new Headers({ "content-length": String(limit) })),
      limit
    ),
    JSON.parse(exactText)
  );

  let declaredRead = false;
  let declaredCancelled = false;
  const declaredOversize = {
    headers: new Headers({ "content-length": String(limit + 1) }),
    body: {
      async cancel() { declaredCancelled = true; },
      getReader() {
        declaredRead = true;
        throw new Error("oversized declared body must not be read");
      }
    }
  };
  await assert.rejects(readJsonObjectLimited(declaredOversize, limit), RangeError);
  assert.equal(declaredRead, false);
  assert.equal(declaredCancelled, true);

  let streamedCancelled = false;
  const streamedOversize = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(limit + 1));
    },
    cancel() { streamedCancelled = true; }
  });
  await assert.rejects(
    readJsonObjectLimited({ headers: new Headers(), body: streamedOversize }, limit),
    RangeError
  );
  assert.equal(streamedCancelled, true);

  let invalidLengthCancelled = false;
  const invalidLength = {
    headers: new Headers({ "content-length": "1, 1" }),
    body: {
      async cancel() { invalidLengthCancelled = true; },
      getReader() { throw new Error("invalid length must be rejected before reading"); }
    }
  };
  await assert.rejects(readJsonObjectLimited(invalidLength, limit), SyntaxError);
  assert.equal(invalidLengthCancelled, true);

  await assert.rejects(
    readJsonObjectLimited(
      requestFromChunks([bytes({ x: "short" })], new Headers({ "content-length": "1" })),
      limit
    ),
    /content_length_mismatch/
  );
  await assert.rejects(readJsonObjectLimited(requestFromChunks([bytes("{")]), limit), SyntaxError);
  await assert.rejects(readJsonObjectLimited(requestFromChunks([bytes("null")]), limit), SyntaxError);
  await assert.rejects(readJsonObjectLimited(requestFromChunks([bytes("[]")]), limit), SyntaxError);
  await assert.rejects(
    readJsonObjectLimited(requestFromChunks([new Uint8Array([0xff])]), limit),
    SyntaxError
  );
  await assert.rejects(
    readJsonObjectLimited({ headers: new Headers(), body: null }, limit),
    SyntaxError
  );

  const splitUtf8 = bytes({ value: "á" });
  const splitAt = splitUtf8.findIndex(byte => byte >= 0xc0);
  assert.deepEqual(
    await readJsonObjectLimited(
      requestFromChunks([splitUtf8.slice(0, splitAt + 1), splitUtf8.slice(splitAt + 1)]),
      limit
    ),
    { value: "á" }
  );

  for (const endpoint of [
    "supabase/functions/sync-operations/index.ts",
    "supabase/functions/realtime-snapshot/index.ts"
  ]) {
    const source = fs.readFileSync(path.join(__dirname, endpoint), "utf8");
    assert.match(source, /import \{ readJsonObjectLimited \} from ['"]\.\.\/_shared\/request-body\.mjs['"]/);
    assert.match(source, /readJsonObjectLimited\(req,\s*MAX_REQUEST_BYTES\)/);
  }

  console.log("Request body hardening regressions passed.");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
