function captureAndReturn(captureList, retval, ...args) {
  captureList.push(JSON.parse(JSON.stringify(args)));
  return retval;
}

module.exports = {
  captureAndReturn
};
