/** Error thrown when a Jamulus protocol message cannot be encoded or decoded. */
export class ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtocolError';
  }
}
