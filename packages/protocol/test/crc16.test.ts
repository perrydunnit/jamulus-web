import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { Crc16, crc16 } from '../src/crc16.ts';

test('empty input yields the inverted all-ones state', () => {
  // Initial register is 0xFFFFFFFF; inverting and masking to 16 bits gives 0.
  assert.equal(crc16(new Uint8Array(0)), 0);
});

test('matches the CRC-16/CCITT-FALSE check value (bit-inverted)', () => {
  // The Jamulus CRC is CRC-16/CCITT-FALSE with the result inverted on the wire.
  // CRC-16/CCITT-FALSE("123456789") = 0x29B1, so the transmitted value is 0xD64E.
  assert.equal(crc16(new TextEncoder().encode('123456789')), 0xd64e);
});

test('CRC is deterministic for the same input', () => {
  const data = new TextEncoder().encode('123456789');
  assert.equal(crc16(data), crc16(data));
});

test('CRC depends on byte order', () => {
  const a = crc16(new Uint8Array([0x01, 0x02]));
  const b = crc16(new Uint8Array([0x02, 0x01]));
  assert.notEqual(a, b);
});

test('CRC fits in 16 bits', () => {
  const value = crc16(new Uint8Array([0xff, 0x00, 0xaa, 0x55, 0x12]));
  assert.ok(value >= 0 && value <= 0xffff);
});

test('incremental and one-shot computation agree', () => {
  const data = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x42]);
  const incremental = new Crc16();
  incremental.addByte(0xde);
  incremental.addBytes(data, 1, data.length);
  assert.equal(incremental.getCrc(), crc16(data));
});
