import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  decodeMessage,
  encodeMessage,
  encodeSplitContainer,
  isConnectionLessMessageId,
  SplitMessageReassembler,
} from '../src/message.ts';
import { MessageId, MessageLengthWithoutData } from '../src/constants.ts';

test('a message round-trips through encode/decode', () => {
  const data = new Uint8Array([1, 2, 3, 4, 5]);
  const frame = encodeMessage(7, MessageId.ChannelInfos, data);
  const decoded = decodeMessage(frame);
  assert.ok(decoded);
  assert.equal(decoded.id, MessageId.ChannelInfos);
  assert.equal(decoded.cnt, 7);
  assert.deepEqual(Array.from(decoded.data), Array.from(data));
});

test('an empty body round-trips', () => {
  const frame = encodeMessage(0, MessageId.ReqJitBufSize);
  assert.equal(frame.length, MessageLengthWithoutData);
  const decoded = decodeMessage(frame);
  assert.ok(decoded);
  assert.equal(decoded.id, MessageId.ReqJitBufSize);
  assert.equal(decoded.data.length, 0);
});

test('a corrupt payload fails the CRC check', () => {
  const frame = encodeMessage(1, MessageId.ChatText, new Uint8Array([10, 20]));
  frame[MessageLengthWithoutData] = 99; // flip a payload byte
  assert.equal(decodeMessage(frame), null);
});

test('a non-zero TAG is rejected', () => {
  const frame = encodeMessage(1, MessageId.ChatText, new Uint8Array([1]));
  frame[0] = 1;
  assert.equal(decodeMessage(frame), null);
});

test('short packets are rejected', () => {
  assert.equal(decodeMessage(new Uint8Array([0, 0, 1])), null);
});

test('connection-less message IDs are recognised', () => {
  assert.equal(isConnectionLessMessageId(1001), true);
  assert.equal(isConnectionLessMessageId(1999), true);
  assert.equal(isConnectionLessMessageId(999), false);
  assert.equal(isConnectionLessMessageId(2000), false);
});

test('split messages are reassembled in order', () => {
  const original = new Uint8Array(Array.from({ length: 12 }, (_, i) => i));
  const parts = [original.subarray(0, 5), original.subarray(5, 9), original.subarray(9, 12)];

  const reassembler = new SplitMessageReassembler();
  const first = reassembler.push(encodeSplitContainer(MessageId.ChatText, 3, 0, parts[0]!));
  const second = reassembler.push(encodeSplitContainer(MessageId.ChatText, 3, 1, parts[1]!));
  const third = reassembler.push(encodeSplitContainer(MessageId.ChatText, 3, 2, parts[2]!));

  assert.equal(first, null);
  assert.equal(second, null);
  assert.ok(third);
  assert.equal(third.id, MessageId.ChatText);
  assert.deepEqual(Array.from(third.data), Array.from(original));
});

test('an out-of-order split part resets the accumulator', () => {
  const reassembler = new SplitMessageReassembler();
  // Part 1 arrives first: it must be discarded and the accumulator reset.
  assert.equal(reassembler.push(encodeSplitContainer(MessageId.ChatText, 2, 1, new Uint8Array([9]))), null);

  const first = reassembler.push(encodeSplitContainer(MessageId.ChatText, 2, 0, new Uint8Array([1])));
  const second = reassembler.push(encodeSplitContainer(MessageId.ChatText, 2, 1, new Uint8Array([2])));
  assert.equal(first, null);
  assert.ok(second);
  assert.equal(second.id, MessageId.ChatText);
  assert.deepEqual(Array.from(second.data), [1, 2]);
});
