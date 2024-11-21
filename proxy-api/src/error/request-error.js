class RequestError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
    this.showMessage = true;
  }
}

module.exports = RequestError;
