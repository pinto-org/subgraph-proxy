class RateLimitError extends Error {
  constructor(message, statusCode = 429) {
    super(message);
    this.statusCode = statusCode;
    this.showMessage = true;
  }
}

module.exports = RateLimitError;
