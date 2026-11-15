// Errors whose message is safe to show to the client (unlike internal failures).
export class ClientError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = this.constructor.name;
    this.status = status; // HTTP status when it happens during an HTTP request or upgrade
  }
}

export class InvalidOperationError extends ClientError {}

export class InvalidDocumentIdError extends ClientError {
  constructor(message = 'Invalid document id') {
    super(message, 400);
  }
}

export class RoomLimitError extends ClientError {
  constructor(message = 'Too many open documents') {
    super(message, 503);
  }
}