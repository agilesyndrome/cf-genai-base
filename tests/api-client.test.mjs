import assert from "node:assert/strict";
import test from "node:test";
import {
  ApiError,
  SECURITY_HEADER_NAMES,
  apiFetch,
  apiJson,
  assertJsonError,
  assertSecurityHeaders,
} from "../src/api/index.js";

async function withFetch(fetchImplementation, callback) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImplementation;
  try {
    return await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("apiFetch returns validated JSON without consuming the original response", async () => {
  const response = Response.json({ item: { id: "item-1" } });
  await withFetch(async () => response, async () => {
    const result = await apiFetch("https://example.test/api/items/item-1", {
      validateJson: (value) => Boolean(
        value
        && typeof value === "object"
        && "item" in value
        && value.item
        && typeof value.item === "object"
        && "id" in value.item
        && typeof value.item.id === "string",
      ),
    });
    assert.deepEqual(result, { item: { id: "item-1" } });
    assert.equal(response.bodyUsed, false);
  });
});

test("apiFetch returns unread Responses for empty and non-JSON success bodies", async () => {
  for (const response of [
    new Response(null, { status: 204 }),
    new Response("plain text", { headers: { "Content-Type": "text/plain" } }),
  ]) {
    await withFetch(async () => response, async () => {
      const result = await apiFetch("https://example.test/api/result");
      assert.equal(result, response);
      assert.equal(response.bodyUsed, false);
    });
  }
});

test("apiFetch reports JSON errors with status and request ID", async () => {
  const response = Response.json(
    { error: "Item is unavailable", internal: "not exposed" },
    { status: 409, headers: { "X-Request-ID": "request-123" } },
  );
  await withFetch(async () => response, async () => {
    await assert.rejects(
      () => apiFetch("https://example.test/api/items/item-1"),
      (error) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.message, "Item is unavailable");
        assert.equal(error.status, 409);
        assert.equal(error.requestId, "request-123");
        assert.doesNotMatch(error.message, /not exposed/);
        return true;
      },
    );
  });
});

test("apiFetch safely falls back for non-JSON and malformed error envelopes", async () => {
  for (const response of [
    new Response("gateway failure", { status: 502 }),
    Response.json({ error: { message: "wrong shape" } }, { status: 422 }),
    Response.json(["wrong shape"], { status: 400 }),
  ]) {
    await withFetch(async () => response, async () => {
      await assert.rejects(
        () => apiFetch("https://example.test/api/result"),
        (error) => {
          assert.ok(error instanceof ApiError);
          assert.equal(error.message, `Request failed (${response.status})`);
          assert.equal(error.status, response.status);
          assert.equal(error.requestId, null);
          return true;
        },
      );
    });
  }
});

test("apiFetch retains defaults while allowing case-insensitive header overrides", async () => {
  const requests = [];
  await withFetch(async (_input, init) => {
    requests.push(init);
    return Response.json({ ok: true });
  }, async () => {
    await apiFetch("https://example.test/api/defaults", {
      method: "PATCH",
      body: "{}",
      headers: { "X-Client": "sdk-test" },
    });
    await apiFetch("https://example.test/api/overrides", {
      body: "{}",
      headers: {
        accept: "application/vnd.example+json",
        "content-type": "application/merge-patch+json",
        "x-client": "sdk-override-test",
      },
      signal: AbortSignal.abort(),
    }).catch(() => {});
  });

  assert.equal(requests[0].credentials, "same-origin");
  assert.equal(requests[0].method, "PATCH");
  assert.equal(requests[0].headers.get("Accept"), "application/json");
  assert.equal(requests[0].headers.get("Content-Type"), "application/json");
  assert.equal(requests[0].headers.get("X-Client"), "sdk-test");
  assert.equal(requests[1].headers.get("Accept"), "application/vnd.example+json");
  assert.equal(requests[1].headers.get("Content-Type"), "application/merge-patch+json");
  assert.equal(requests[1].headers.get("X-Client"), "sdk-override-test");
  assert.equal(requests[1].signal.aborted, true);
});

test("apiJson serializes JSON and defaults its method to POST", async () => {
  let requestInit;
  await withFetch(async (_input, init) => {
    requestInit = init;
    return Response.json({ saved: true });
  }, async () => {
    assert.deepEqual(
      await apiJson("https://example.test/api/items", { name: "Soup", tags: ["dinner"] }),
      { saved: true },
    );
  });
  assert.equal(requestInit.method, "POST");
  assert.equal(requestInit.body, JSON.stringify({ name: "Soup", tags: ["dinner"] }));
  assert.equal(requestInit.headers.get("Content-Type"), "application/json");
});

test("API testing helpers assert security headers and JSON error envelopes", async () => {
  const headers = new Headers();
  for (const name of SECURITY_HEADER_NAMES) headers.set(name, "present");
  const secureResponse = new Response(null, { headers });
  assert.equal(assertSecurityHeaders(secureResponse), secureResponse);

  headers.delete("X-Frame-Options");
  assert.throws(
    () => assertSecurityHeaders(new Response(null, { headers })),
    /Missing security header: X-Frame-Options/,
  );

  const errorResponse = Response.json({ error: "Denied", reason: "policy" }, { status: 403 });
  assert.deepEqual(await assertJsonError(errorResponse, 403), { error: "Denied", reason: "policy" });
  assert.equal(errorResponse.bodyUsed, false);

  await assert.rejects(
    () => assertJsonError(new Response("not json", { status: 400 }), 400),
    /Expected a JSON error envelope/,
  );
  await assert.rejects(
    () => assertJsonError(Response.json({ error: 42 }, { status: 400 }), 400),
    /Expected a JSON error envelope/,
  );
  await assert.rejects(
    () => assertJsonError(Response.json({ error: "wrong status" }, { status: 401 }), 403),
    /Expected 403, received 401/,
  );
});
