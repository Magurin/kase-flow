// The SPL SDK uses these four functions. Native bigint-buffer has an unfixed
// buffer-overflow advisory (GHSA-3gc7-fjrx-p6mg); no native code is loaded here.
function decode(value, little) {
  if (!Buffer.isBuffer(value)) throw new TypeError("Expected Buffer");
  if (value.length > 4096) throw new RangeError("Buffer too large");
  let result = 0n;
  for (let i = 0; i < value.length; i++) result = (result << 8n) | BigInt(value[little ? value.length - i - 1 : i]);
  return result;
}
function encode(value, width, little) {
  if (typeof value !== "bigint" || value < 0n) throw new TypeError("Expected unsigned bigint");
  if (!Number.isSafeInteger(width) || width < 0 || width > 4096) throw new RangeError("Invalid width");
  if (value >= (1n << BigInt(width * 8))) throw new RangeError("Integer does not fit");
  const result = Buffer.alloc(width);
  for (let i = 0; i < width; i++) { result[little ? i : width - i - 1] = Number(value & 255n); value >>= 8n; }
  return result;
}
exports.toBigIntLE = value => decode(value, true);
exports.toBigIntBE = value => decode(value, false);
exports.toBufferLE = (value, width) => encode(value, width, true);
exports.toBufferBE = (value, width) => encode(value, width, false);
