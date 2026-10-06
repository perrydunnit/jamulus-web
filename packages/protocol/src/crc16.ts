/**
 * CRC-16 used by the Jamulus protocol.
 *
 * The reference implementation (`CCRC` in `src/util.cpp` / `src/util.h`) uses a
 * 32-bit shift register, the polynomial mask `(1 << 5) | (1 << 12)` and an
 * initial state of all ones. The transmitted value is the bit-wise inverse of
 * the register, truncated to 16 bits.
 *
 * Note that the polynomial mask deliberately omits the x^16 and x^0 terms: the
 * feedback path and the LSB handling in `addByte` supply them implicitly. With
 * this mask the algorithm is equivalent to CRC-16/CCITT-FALSE (poly 0x1021,
 * init 0xFFFF, no reflection) with a final bit-inversion, which is asserted by
 * the unit tests: crc16("123456789") === 0xD64E, the inverse of 0x29B1.
 */
export class Crc16 {
  /** Polynomial mask: (1 << 5) | (1 << 12). */
  private static readonly Poly = (1 << 5) | (1 << 12); // 0x1020
  /** Mask of the bit that is shifted out of the 16-bit register. */
  private static readonly BitOutMask = 1 << 16; // 0x10000

  private state = 0xffffffff;

  /** Reset the shift register to its initial "all ones" state. */
  reset(): void {
    this.state = 0xffffffff;
  }

  /** Feed a single byte into the CRC register. */
  addByte(byte: number): void {
    for (let i = 0; i < 8; i++) {
      // Shift the register; the bit leaving the 16-bit frame is fed back to the LSB.
      this.state = (this.state << 1) >>> 0;
      if ((this.state & Crc16.BitOutMask) > 0) {
        this.state |= 1;
      }

      // Fold in the next input bit (MSB first).
      if ((byte & (1 << (8 - i - 1))) > 0) {
        this.state ^= 1;
      }

      // Conditionally apply the generator polynomial.
      if (this.state & 1) {
        this.state = (this.state ^ Crc16.Poly) >>> 0;
      }
    }
  }

  /** Feed a byte range into the CRC register. */
  addBytes(data: Uint8Array, start = 0, end = data.length): void {
    for (let i = start; i < end; i++) {
      this.addByte(data[i] as number);
    }
  }

  /** Return the inverted, 16-bit CRC of everything added so far. */
  getCrc(): number {
    const inverted = (~this.state) >>> 0;
    return inverted & (Crc16.BitOutMask - 1);
  }
}

/** Compute the Jamulus CRC over a byte range. */
export function crc16(data: Uint8Array, start = 0, end = data.length): number {
  const crc = new Crc16();
  crc.addBytes(data, start, end);
  return crc.getCrc();
}
