import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  decodeAck,
  decodeChannelInfo,
  decodeChatText,
  decodeClientId,
  decodeConnectedClients,
  decodeJitterBufferSize,
  decodeNetworkTransportProps,
  decodePing,
  decodeVersionAndOs,
  encodeAck,
  encodeChannelInfo,
  encodeChatText,
  encodeJitterBufferSize,
  encodeNetworkTransportProps,
  encodePing,
  encodeVersionAndOs,
  rawAudioBytesPerFrame,
  rawAudioBytesPerSecond,
} from '../src/codecs.ts';
import { AudioCodec, NetwFlags, SystemSampleRateHz } from '../src/constants.ts';

test('network transport props round-trip', () => {
  const encoded = encodeNetworkTransportProps({
    baseNetworkPacketSize: 256,
    blockSizeFact: 1,
    numAudioChannels: 1,
    sampleRate: SystemSampleRateHz,
    audioCodingType: AudioCodec.Opus,
    flags: NetwFlags.WithCounter,
  });
  assert.equal(encoded.length, 19);
  const decoded = decodeNetworkTransportProps(encoded);
  assert.equal(decoded.baseNetworkPacketSize, 256);
  assert.equal(decoded.blockSizeFact, 1);
  assert.equal(decoded.numAudioChannels, 1);
  assert.equal(decoded.sampleRate, SystemSampleRateHz);
  assert.equal(decoded.audioCodingType, AudioCodec.Opus);
  assert.equal(decoded.flags, NetwFlags.WithCounter);
  assert.equal(decoded.audioCodingArg, 0);
});

test('channel info round-trips unicode names', () => {
  const encoded = encodeChannelInfo({
    country: 0,
    instrument: 0,
    skillLevel: 0,
    name: 'Zoë 🎸',
    city: 'München',
  });
  const decoded = decodeChannelInfo(encoded);
  assert.equal(decoded.name, 'Zoë 🎸');
  assert.equal(decoded.city, 'München');
});

test('connected clients list decodes multiple entries', () => {
  const writerParts: number[] = [];
  const pushEntry = (id: number, name: string, city: string): void => {
    writerParts.push(id, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    const nameBytes = [...new TextEncoder().encode(name)];
    writerParts.push(nameBytes.length, 0, ...nameBytes);
    const cityBytes = [...new TextEncoder().encode(city)];
    writerParts.push(cityBytes.length, 0, ...cityBytes);
  };
  pushEntry(3, 'Alice', 'Berlin');
  pushEntry(7, 'Bob', 'Paris');

  const clients = decodeConnectedClients(new Uint8Array(writerParts));
  assert.equal(clients.length, 2);
  assert.equal(clients[0]!.channelId, 3);
  assert.equal(clients[0]!.name, 'Alice');
  assert.equal(clients[0]!.city, 'Berlin');
  assert.equal(clients[1]!.channelId, 7);
  assert.equal(clients[1]!.name, 'Bob');
});

test('simple scalar bodies round-trip', () => {
  assert.equal(decodeJitterBufferSize(encodeJitterBufferSize(5)), 5);
  assert.equal(decodeAck(encodeAck(24)), 24);
  assert.equal(decodePing(encodePing(123456)), 123456);
  assert.equal(decodeChatText(encodeChatText('hello')), 'hello');
  assert.equal(decodeClientId(new Uint8Array([9])), 9);
});

test('version and OS body round-trips', () => {
  const { os, version } = decodeVersionAndOs(encodeVersionAndOs(2, '3.10.0'));
  assert.equal(os, 2);
  assert.equal(version, '3.10.0');
});

test('raw audio frame sizing', () => {
  assert.equal(rawAudioBytesPerFrame(1, 128), 256);
  assert.equal(rawAudioBytesPerFrame(2, 128), 512);
  assert.equal(rawAudioBytesPerSecond(1, 128), 256 * (SystemSampleRateHz / 128));
});
