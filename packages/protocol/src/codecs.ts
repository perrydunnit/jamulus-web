/**
 * Typed encoders/decoders for the Jamulus message bodies used by the web bridge.
 *
 * Only the messages needed to join a session, stream raw audio and list the
 * connected clients are implemented.
 */
import { ByteReader, ByteWriter } from './bytes.ts';
import type { AudioCodec, NetwFlags } from './constants.ts';
import { OpSystemType, SystemSampleRateHz } from './constants.ts';
import { ProtocolError } from './errors.ts';

/** Network transport properties (message 20). */
export interface NetworkTransportProps {
  /** Length of the base network packet (frame) in bytes. */
  baseNetworkPacketSize: number;
  /** Block size factor (1 = 64, 2 = 128, 4 = 256 samples). */
  blockSizeFact: number;
  /** Number of audio channels (1 = mono, 2 = stereo). */
  numAudioChannels: number;
  /** Sample rate of the audio stream. */
  sampleRate: number;
  /** Audio coding type. */
  audioCodingType: AudioCodec;
  /** Network transport flags. */
  flags: NetwFlags;
  /** Codec-specific argument (0 when unused). */
  audioCodingArg?: number;
}

/** Encode a NETW_TRANSPORT_PROPS body. */
export function encodeNetworkTransportProps(props: NetworkTransportProps): Uint8Array {
  const writer = new ByteWriter(19);
  writer.uint(props.baseNetworkPacketSize, 4);
  writer.uint(props.blockSizeFact, 2);
  writer.u8(props.numAudioChannels);
  writer.uint(props.sampleRate, 4);
  writer.uint(props.audioCodingType, 2);
  writer.uint(props.flags, 2);
  writer.uint(props.audioCodingArg ?? 0, 4);
  return writer.toUint8Array();
}

/** Decode a NETW_TRANSPORT_PROPS body. */
export function decodeNetworkTransportProps(data: Uint8Array): NetworkTransportProps {
  const reader = new ByteReader(data);
  const props: NetworkTransportProps = {
    baseNetworkPacketSize: reader.uint(4),
    blockSizeFact: reader.uint(2),
    numAudioChannels: reader.u8(),
    sampleRate: reader.uint(4),
    audioCodingType: reader.uint(2) as AudioCodec,
    flags: reader.uint(2) as NetwFlags,
    audioCodingArg: reader.int(4),
  };
  if (!reader.done) {
    throw new ProtocolError('NETW_TRANSPORT_PROPS has trailing bytes');
  }
  return props;
}

/** Channel core info: the identity a client advertises to the server. */
export interface ChannelInfo {
  country: number;
  instrument: number;
  skillLevel: number;
  name: string;
  city: string;
}

/** Encode a CHANNEL_INFOS body. */
export function encodeChannelInfo(info: ChannelInfo): Uint8Array {
  const writer = new ByteWriter();
  writer.uint(info.country, 2);
  writer.uint(info.instrument, 4);
  writer.u8(info.skillLevel);
  writer.utf8(info.name);
  writer.utf8(info.city);
  return writer.toUint8Array();
}

/** Decode a CHANNEL_INFOS body. */
export function decodeChannelInfo(data: Uint8Array): ChannelInfo {
  const reader = new ByteReader(data);
  const info: ChannelInfo = {
    country: reader.uint(2),
    instrument: reader.uint(4),
    skillLevel: reader.u8(),
    name: reader.utf8(),
    city: reader.utf8(),
  };
  if (!reader.done) {
    throw new ProtocolError('CHANNEL_INFOS has trailing bytes');
  }
  return info;
}

/** One entry of the connected-clients list. */
export interface ConnectedClient {
  channelId: number;
  country: number;
  instrument: number;
  skillLevel: number;
  name: string;
  city: string;
}

/** Decode a CONN_CLIENTS_LIST body into its entries. */
export function decodeConnectedClients(data: Uint8Array): ConnectedClient[] {
  const reader = new ByteReader(data);
  const clients: ConnectedClient[] = [];
  while (!reader.done) {
    if (reader.remaining < 12) {
      throw new ProtocolError('CONN_CLIENTS_LIST entry is truncated');
    }
    const channelId = reader.u8();
    const country = reader.uint(2);
    const instrument = reader.uint(4);
    const skillLevel = reader.u8();
    reader.skip(4); // formerly the IP address, now always zero
    const name = reader.utf8();
    const city = reader.utf8();
    clients.push({ channelId, country, instrument, skillLevel, name, city });
  }
  return clients;
}

/** Encode a JITT_BUF_SIZE body. */
export function encodeJitterBufferSize(blocks: number): Uint8Array {
  const writer = new ByteWriter(2);
  writer.uint(blocks, 2);
  return writer.toUint8Array();
}

/** Decode a JITT_BUF_SIZE body. */
export function decodeJitterBufferSize(data: Uint8Array): number {
  const reader = new ByteReader(data);
  return reader.uint(2);
}

/** Encode an ACK body (the ID of the message being acknowledged). */
export function encodeAck(acknowledgedId: number): Uint8Array {
  const writer = new ByteWriter(2);
  writer.uint(acknowledgedId, 2);
  return writer.toUint8Array();
}

/** Decode an ACK body. */
export function decodeAck(data: Uint8Array): number {
  const reader = new ByteReader(data);
  return reader.uint(2);
}

/** Encode a CLM_PING_MS body. */
export function encodePing(transmitTimeMs: number): Uint8Array {
  const writer = new ByteWriter(4);
  writer.uint(transmitTimeMs, 4);
  return writer.toUint8Array();
}

/** Decode a CLM_PING_MS body. */
export function decodePing(data: Uint8Array): number {
  const reader = new ByteReader(data);
  return reader.int(4);
}

/** Encode a CHAT_TEXT body. */
export function encodeChatText(text: string): Uint8Array {
  const writer = new ByteWriter();
  writer.utf8(text);
  return writer.toUint8Array();
}

/** Decode a CHAT_TEXT body. */
export function decodeChatText(data: Uint8Array): string {
  return new ByteReader(data).utf8();
}

/** Decode a VERSION_AND_OS body. */
export function decodeVersionAndOs(data: Uint8Array): { os: number; version: string } {
  const reader = new ByteReader(data);
  const os = reader.u8();
  const version = reader.utf8();
  return { os, version };
}

/** Encode a VERSION_AND_OS body. */
export function encodeVersionAndOs(os: number = OpSystemType.Linux, version = 'jamulus-web'): Uint8Array {
  const writer = new ByteWriter();
  writer.u8(os);
  writer.utf8(version);
  return writer.toUint8Array();
}

/** Decode a CLIENT_ID body. */
export function decodeClientId(data: Uint8Array): number {
  return new ByteReader(data).u8();
}

/** Decode a LICENCE_REQUIRED body. */
export function decodeLicenceRequired(data: Uint8Array): number {
  return new ByteReader(data).u8();
}

/** Decode a RECORDER_STATE body. */
export function decodeRecorderState(data: Uint8Array): number {
  return new ByteReader(data).u8();
}

/**
 * Compute the coded byte count for one raw-audio frame.
 *
 * Raw (uncompressed) audio uses 16-bit samples and is recognised by the server
 * from the packet size, so the transport properties still advertise OPUS.
 */
export function rawAudioBytesPerFrame(numChannels: number, frameSizeSamples: number): number {
  return 2 * numChannels * frameSizeSamples;
}

/** Bytes per second for a raw-audio stream of the given frame size. */
export function rawAudioBytesPerSecond(numChannels: number, frameSizeSamples: number): number {
  return rawAudioBytesPerFrame(numChannels, frameSizeSamples) * (SystemSampleRateHz / frameSizeSamples);
}
