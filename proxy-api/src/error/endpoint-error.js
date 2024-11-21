class EndpointError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
    this.showMessage = true;
  }
}

module.exports = EndpointError;
