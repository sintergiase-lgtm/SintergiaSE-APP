export const MAX_AUTH_REQUEST_BYTES = 4 * 1024;

async function cancelBody(body) {
  try {
    await body?.cancel();
  } catch {
    // The request may already be locked or aborted; the size error still applies.
  }
}

export async function readAuthJson(req) {
  const declaredLength = req.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) {
      await cancelBody(req.body);
      throw new SyntaxError("invalid_content_length");
    }

    const declaredBytes = Number(declaredLength);
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes > MAX_AUTH_REQUEST_BYTES) {
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

      totalBytes += value.byteLength;
      if (totalBytes > MAX_AUTH_REQUEST_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new RangeError("request_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new SyntaxError("invalid_json");
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new SyntaxError("invalid_json");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new SyntaxError("invalid_json_object");
  }

  return payload;
}
