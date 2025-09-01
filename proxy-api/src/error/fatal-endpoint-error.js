class FatalEndpointError extends Error {
  constructor(message, statusCode = 520) {
    super(message);
    this.statusCode = statusCode;
    this.showMessage = true;
  }
}

module.exports = FatalEndpointError;
