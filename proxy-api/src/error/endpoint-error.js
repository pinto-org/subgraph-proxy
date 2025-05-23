class EndpointError extends Error {
  constructor(message, statusCode = 503) {
    super(message);
    this.statusCode = statusCode;
    this.showMessage = true;
  }
}

module.exports = EndpointError;
