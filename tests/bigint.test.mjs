import test from "node:test";
import assert from "node:assert/strict";
import {
  toBigIntLE,
  toBigIntBE,
  toBufferLE,
  toBufferBE,
} from "../vendor/bigint-buffer/index.cjs";
test("SDK integer codec covers u64/u128, endianness and rejects invalid native-buffer inputs", () => {
  for (const width of [0, 1, 8, 16, 32]) {
    const n = (1n << BigInt(width * 8)) - 1n;
    assert.equal(toBigIntLE(toBufferLE(n, width)), n);
    assert.equal(toBigIntBE(toBufferBE(n, width)), n);
  }
  assert.deepEqual(toBufferLE(0x010203n, 3), Buffer.from([3, 2, 1]));
  assert.deepEqual(toBufferBE(0x010203n, 3), Buffer.from([1, 2, 3]));
  assert.equal(toBigIntLE(Buffer.alloc(0)), 0n);
  for (const value of [null, undefined, "oops", 123])
    assert.throws(() => toBigIntLE(value));
  assert.throws(() => toBufferLE(-1n, 8));
  assert.throws(() => toBufferLE(256n, 1));
  assert.throws(() => toBufferLE(1n, NaN));
  assert.throws(() => toBufferLE(0n, Number.MAX_SAFE_INTEGER));
});
