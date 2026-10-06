/**
 * Jamulus message framing: header, CRC and split-message reassembly.
 *
 * Wire layout of a protocol message:
 *
 *   +--------+--------+--------+---------+----------+--------+
 *   | TAG(2) | ID(2)  | cnt(1) | len(2)  | data(n)  | CRC(2) |
 *   +--------+--------+--------+---------+----------+--------+
 *
 * TAG is always zero, integers are little-endian, and the CRC covers the
 * header and data but not the CRC bytes themselves.
 */
import { ByteReader, ByteWriter } from './bytes.ts';
import { crc16 } from './crc16.ts';
import { MessageHeaderLength, MessageLengthWithoutData } from './constants.ts';
import { ProtocolError } from './errors.ts';

/** A decoded protocol message. */
export interface DecodedMessage {
  /** Message type ID (see `MessageId` / `ConnectionLessMessageId`). */
  id: number;
  /** Wrapping sequence counter (0 for connection-less messages). */
  cnt: number;
  /** Message body. */
  data: Uint8Array;
}

/** True if the ID belongs to the connection-less message range (1000..1999). */
export function isConnectionLessMessageId(id: number): boolean {
  return id >= 1000 && id <= 1999;
}

/**
 * Encode a complete protocol message including header and CRC.
 */
export function encodeMessage(cnt: number, id: number, data: Uint8Array = new Uint8Array(0)): Uint8Array {
  const writer = new ByteWriter(MessageLengthWithoutData + data.length);
  writer.uint(0, 2); // TAG
  writer.uint(id, 2);
  writer.u8(cnt);
  writer.uint(data.length, 2);
  writer.bytes(data);

  const frame = writer.toUint8Array();
  const checksum = crc16(frame, 0, MessageHeaderLength + data.length);

  const out = new Uint8Array(frame.length + 2);
  out.set(frame, 0);
  out[frame.length] = checksum & 0xff;
  out[frame.length + 1] = (checksum >> 8) & 0xff;
  return out;
}

/**
 * Decode a protocol message frame.
 *
 * Returns `null` when the packet is not a valid protocol message (wrong length,
 * non-zero TAG or CRC mismatch). Audio packets are not protocol messages, so
 * callers treat `null` as "this is probably audio".
 */
export function decodeMessage(packet: Uint8Array): DecodedMessage | null {
  if (packet.length < MessageLengthWithoutData) {
    return null;
  }

  const reader = new ByteReader(packet);
  if (reader.uint(2) !== 0) {
    return null; // TAG must be zero
  }
  const id = reader.uint(2);
  const cnt = reader.u8();
  const declaredLength = reader.uint(2);

  if (declaredLength !== packet.length - MessageLengthWithoutData) {
    return null;
  }

  const expectedCrc = crc16(packet, 0, MessageHeaderLength + declaredLength);
  const actualCrc = packet[packet.length - 2]! | (packet[packet.length - 1]! << 8);
  if (expectedCrc !== actualCrc) {
    return null;
  }

  const data = packet.subarray(MessageHeaderLength, MessageHeaderLength + declaredLength);
  return { id, cnt, data: new Uint8Array(data) };
}

/** Encode the body of a split-message container. */
export function encodeSplitContainer(
  originalId: number,
  numParts: number,
  splitCnt: number,
  dataPart: Uint8Array,
): Uint8Array {
  const writer = new ByteWriter(4 + dataPart.length);
  writer.uint(originalId, 2);
  writer.u8(numParts);
  writer.u8(splitCnt);
  writer.bytes(dataPart);
  return writer.toUint8Array();
}

/** Result of feeding one part into the reassembler. */
export interface ReassembledMessage {
  id: number;
  data: Uint8Array;
}

/**
 * Reassembles messages that arrive as several `SpecialSplitMessageId` parts.
 *
 * Parts are expected in order; an out-of-order or inconsistent part resets the
 * accumulator, matching the behaviour of the reference implementation.
 */
export class SplitMessageReassembler {
  private parts: Uint8Array[] = [];
  private expectedParts = 0;
  private nextPart = 0;
  private originalId = 0;

  /** Feed a split container body; returns the completed message or `null`. */
  push(container: Uint8Array): ReassembledMessage | null {
    if (container.length < 4) {
      this.reset();
      return null;
    }
    const reader = new ByteReader(container);
    const id = reader.uint(2);
    const numParts = reader.u8();
    const splitCnt = reader.u8();
    const part = reader.bytes(reader.remaining);

    if (splitCnt !== this.nextPart || (this.parts.length > 0 && id !== this.originalId)) {
      this.reset();
    }

    if (splitCnt === 0) {
      this.originalId = id;
      this.expectedParts = numParts;
    } else if (id !== this.originalId || numParts !== this.expectedParts) {
      this.reset();
      return null;
    }

    this.parts.push(new Uint8Array(part));
    this.nextPart++;

    if (this.parts.length !== this.expectedParts) {
      return null;
    }

    const total = this.parts.reduce((sum, p) => sum + p.length, 0);
    const data = new Uint8Array(total);
    let offset = 0;
    for (const p of this.parts) {
      data.set(p, offset);
      offset += p.length;
    }
    const id2 = this.originalId;
    this.reset();
    return { id: id2, data };
  }

  /** Discard any partially accumulated message. */
  reset(): void {
    this.parts = [];
    this.expectedParts = 0;
    this.nextPart = 0;
    this.originalId = 0;
  }
}

export { ProtocolError };
