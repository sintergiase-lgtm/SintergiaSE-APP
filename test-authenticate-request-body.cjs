"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

async function main() {
  const authDir = path.join(
    __dirname,
    "supabase",
    "functions",
    "authenticate"
  );
  const moduleUrl = pathToFileURL(path.join(authDir, "request-body.mjs")).href;
  const { readAuthJson, MAX_AUTH_REQUEST_BYTES } = await import(moduleUrl);
  const encoder = new TextEncoder();

  function requestFromBytes(bytes, headers = new Headers()) {
    return {
      headers,
      body: new ReadableStream({
        start(controller) {
          if (bytes.byteLength) controller.enqueue(bytes);
          controller.close();
        }
      })
    };
  }

  const validPayload = { scope: "modo", password: "synthetic-test" };
  const valid = await readAuthJson(
    requestFromBytes(encoder.encode(JSON.stringify(validPayload)))
  );
  assert.deepEqual(valid, validPayload);

  const exactLimitText =
    '{"x":"' + "a".repeat(MAX_AUTH_REQUEST_BYTES - 8) + '"}';
  assert.equal(encoder.encode(exactLimitText).byteLength, MAX_AUTH_REQUEST_BYTES);
  const exactLimit = await readAuthJson(requestFromBytes(encoder.encode(exactLimitText)));
  assert.equal(exactLimit.x.length, MAX_AUTH_REQUEST_BYTES - 8);

  let bodyRead = false;
  let declaredBodyCancelled = false;
  const declaredTooLarge = {
    headers: new Headers({ "content-length": String(MAX_AUTH_REQUEST_BYTES + 1) }),
    body: {
      async cancel() {
        declaredBodyCancelled = true;
      },
      getReader() {
        bodyRead = true;
        throw new Error("oversized declared bodies must not be read");
      }
    }
  };
  await assert.rejects(readAuthJson(declaredTooLarge), RangeError);
  assert.equal(bodyRead, false);
  assert.equal(declaredBodyCancelled, true);

  let cancelled = false;
  const oversizedStream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(MAX_AUTH_REQUEST_BYTES + 1));
    },
    cancel() {
      cancelled = true;
    }
  });
  await assert.rejects(
    readAuthJson({ headers: new Headers(), body: oversizedStream }),
    RangeError
  );
  assert.equal(cancelled, true);

  const invalidLength = {
    headers: new Headers({ "content-length": "4x" }),
    body: null
  };
  await assert.rejects(readAuthJson(invalidLength), SyntaxError);
  await assert.rejects(
    readAuthJson(requestFromBytes(encoder.encode("{"))),
    SyntaxError
  );
  await assert.rejects(
    readAuthJson(requestFromBytes(encoder.encode("null"))),
    SyntaxError
  );
  await assert.rejects(
    readAuthJson(requestFromBytes(new Uint8Array([0xff]))),
    SyntaxError
  );
  await assert.rejects(
    readAuthJson({ headers: new Headers(), body: null }),
    SyntaxError
  );

  const authSource = fs.readFileSync(
    path.join(authDir, "index.ts"),
    "utf8"
  );
  assert.match(
    authSource,
    /import\s*\{\s*readAuthJson\s*\}\s*from\s*["']\.\/request-body\.mjs["']/
  );
  assert.match(authSource, /await\s+readAuthJson\(req\)/);
  assert.match(
    authSource,
    /instanceof\s+RangeError[\s\S]{0,180}status\s*:\s*413|instanceof\s+RangeError[\s\S]{0,180}json\(req,\s*413/
  );

  process.stdout.write(
    "PASS: auth JSON body is bounded, parsed strictly, cancelled on overflow, and returns 413.\n"
  );
}

main().catch((error) => {
  process.stderr.write((error?.stack || String(error)) + "\n");
  process.exitCode = 1;
});


