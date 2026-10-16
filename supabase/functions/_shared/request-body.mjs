export async function readJsonObjectLimited(req, maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new TypeError("invalid_request_limit");
  }

  const declaredLength = req.headers.get("content-length");
  let declaredBytes = null;
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) {
      await cancelBody(req.body);
      throw new SyntaxError("invalid_content_length");
    }

    declaredBytes = Number(declaredLength);
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes > maxBytes) {
      await cancelBody(req.body);
      throw new RangeError("request_too_large");
    }
  }

  if (!req.body) throw new SyntaxError("empty_body");

  const reader = req.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        throw new SyntaxError("invalid_body_chunk");
      }
      if (value.byteLength > maxBytes - totalBytes) {
        await reader.cancel().catch(() => undefined);
        throw new RangeError("request_too_large");
      }

      totalBytes += value.byteLength;
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  if (declaredBytes !== null && declaredBytes !== totalBytes) {
    throw new SyntaxError("content_length_mismatch");
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let payload;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    payload = JSON.parse(text);
  } catch {
    throw new SyntaxError("invalid_json");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new SyntaxError("invalid_json_object");
  }

  return payload;
}

async function cancelBody(body) {
  try {
    await body?.cancel();
  } catch {
    // A locked or aborted body is already unavailable; preserve the validation error.
  }
}
