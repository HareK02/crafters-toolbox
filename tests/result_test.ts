import { assertEquals } from "@std/assert";
import {
  err,
  isErr,
  isOk,
  map,
  mapErr,
  ok,
  tryCatch,
  tryCatchSync,
  unwrapOr,
} from "../scripts/types/result.ts";

Deno.test("ok - creates success result", () => {
  const result = ok(42);

  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.value, 42);
  }
});

Deno.test("err - creates failure result", () => {
  const error = new Error("test error");
  const result = err(error);

  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.error, error);
  }
});

Deno.test("isOk - returns true for success", () => {
  const result = ok("value");
  assertEquals(isOk(result), true);
});

Deno.test("isOk - returns false for failure", () => {
  const result = err(new Error("error"));
  assertEquals(isOk(result), false);
});

Deno.test("isErr - returns true for failure", () => {
  const result = err(new Error("error"));
  assertEquals(isErr(result), true);
});

Deno.test("isErr - returns false for success", () => {
  const result = ok("value");
  assertEquals(isErr(result), false);
});

Deno.test("unwrapOr - returns value on success", () => {
  const result = ok(42);
  assertEquals(unwrapOr(result, 0), 42);
});

Deno.test("unwrapOr - returns default on failure", () => {
  const result = err(new Error("error"));
  assertEquals(unwrapOr(result, 0), 0);
});

Deno.test("map - transforms success value", () => {
  const result = ok(10);
  const mapped = map(result, (n: number) => n * 2);

  assertEquals(isOk(mapped), true);
  if (mapped.ok) {
    assertEquals(mapped.value, 20);
  }
});

Deno.test("map - preserves failure", () => {
  const error = new Error("error");
  const result = err(error);
  const mapped = map(result, (n: number) => n * 2);

  assertEquals(isErr(mapped), true);
  if (!mapped.ok) {
    assertEquals(mapped.error, error);
  }
});

Deno.test("mapErr - transforms error", () => {
  const result = err("original error");
  const mapped = mapErr(result, (e: string) => `wrapped: ${e}`);

  assertEquals(isErr(mapped), true);
  if (!mapped.ok) {
    assertEquals(mapped.error, "wrapped: original error");
  }
});

Deno.test("mapErr - preserves success", () => {
  const result = ok(42);
  const mapped = mapErr(result, (e: string) => `wrapped: ${e}`);

  assertEquals(isOk(mapped), true);
  if (mapped.ok) {
    assertEquals(mapped.value, 42);
  }
});

Deno.test("tryCatch - wraps successful promise", async () => {
  const result = await tryCatch(Promise.resolve(42));

  assertEquals(isOk(result), true);
  if (result.ok) {
    assertEquals(result.value, 42);
  }
});

Deno.test("tryCatch - wraps rejected promise", async () => {
  const result = await tryCatch(Promise.reject(new Error("test error")));

  assertEquals(isErr(result), true);
  if (!result.ok) {
    assertEquals(result.error.message, "test error");
  }
});

Deno.test("tryCatch - converts non-Error rejections", async () => {
  const result = await tryCatch(Promise.reject("string error"));

  assertEquals(isErr(result), true);
  if (!result.ok) {
    assertEquals(result.error.message, "string error");
  }
});

Deno.test("tryCatchSync - wraps successful function", () => {
  const result = tryCatchSync(() => 42);

  assertEquals(isOk(result), true);
  if (result.ok) {
    assertEquals(result.value, 42);
  }
});

Deno.test("tryCatchSync - wraps throwing function", () => {
  const result = tryCatchSync(() => {
    throw new Error("test error");
  });

  assertEquals(isErr(result), true);
  if (!result.ok) {
    assertEquals(result.error.message, "test error");
  }
});
