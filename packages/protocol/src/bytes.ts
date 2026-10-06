/**
 * Little-endian read/write helpers for the Jamulus protocol.
 *
 * All multi-byte integers on the wire are little-endian.
 */
import { ProtocolError } from './errors.ts';

/** Growable little-endian byte writer. */
export class ByteWriter {
  private buf: Uint8Array;
  private pos = 0;

  constructor(initialCapacity = 64) {
    this.buf = new Uint8Array(Math.max(initialCapacity, 1));
  }

  private ensure(extra: number): void {
    const required = this.pos + extra;
    if (required <= this.buf.length) {
      return;
    }
    let size = this.buf.length * 2;
    while (size < required) {
      size *= 2;
    }
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.pos));
    this.buf = next;
  }

  /** Append a single byte. */
  u8(value: number): void {
    this.ensure(1);
    this.buf[this.pos++] = value & 0xff;
  }

  /** Append `count` (1..4) little-endian bytes of `value`. */
  uint(value: number, count: number): void {
    this.ensure(count);
    let remaining = value >>> 0;
    for (let i = 0; i < count; i++) {
      this.buf[this.pos++] = remaining & 0xff;
      remaining >>>= 8;
    }
  }

  /** Append raw bytes. */
  bytes(data: Uint8Array): void {
    this.ensure(data.length);
    this.buf.set(data, this.pos);
    this.pos += data.length;
  }

  /** Append a UTF-8 string prefixed by its byte length (1 or 2 bytes). */
  utf8(value: string, lengthBytes = 2): void {
    const encoded = new TextEncoder().encode(value);
    this.uint(encoded.length, lengthBytes);
    this.bytes(encoded);
  }

  /** Number of bytes written so far. */
  get length(): number {
    return this.pos;
  }

  /** Return a copy of the written bytes. */
  toUint8Array(): Uint8Array {
    return this.buf.slice(0, this.pos);
  }
}

/** Bounds-checked little-endian byte reader. */
export class ByteReader {
  private pos = 0;
  private readonly data: Uint8Array;

  constructor(data: Uint8Array) {
    this.data = data;
  }

  /** Current read offset. */
  get offset(): number {
    return this.pos;
  }

  /** Remaining byte count. */
  get remaining(): number {
    return this.data.length - this.pos;
  }

  /** True when all bytes have been consumed. */
  get done(): boolean {
    return this.pos === this.data.length;
  }

  private require(count: number): void {
    if (this.pos + count > this.data.length) {
      throw new ProtocolError(
        `attempted to read ${count} byte(s) with only ${this.remaining} remaining`,
      );
    }
  }

  /** Read a single byte. */
  u8(): number {
    this.require(1);
    return this.data[this.pos++] as number;
  }

  /** Read `count` (1..4) little-endian bytes as an unsigned integer. */
  uint(count: number): number {
    this.require(count);
    let result = 0;
    for (let i = 0; i < count; i++) {
      result += (this.data[this.pos++] as number) * 2 ** (i * 8);
    }
    return result >>> 0;
  }

  /** Read `count` little-endian bytes as a signed integer. */
  int(count: number): number {
    const raw = this.uint(count);
    const signBit = 2 ** (count * 8 - 1);
    return raw >= signBit ? raw - 2 ** (count * 8) : raw;
  }

  /** Skip `count` bytes. */
  skip(count: number): void {
    this.require(count);
    this.pos += count;
  }

  /** Read raw bytes. */
  bytes(count: number): Uint8Array {
    this.require(count);
    const slice = this.data.subarray(this.pos, this.pos + count);
    this.pos += count;
    return slice;
  }

  /** Read a UTF-8 string prefixed by its byte length (1 or 2 bytes). */
  utf8(lengthBytes = 2): string {
    const length = this.uint(lengthBytes);
    const raw = this.bytes(length);
    return new TextDecoder().decode(raw);
  }
}
