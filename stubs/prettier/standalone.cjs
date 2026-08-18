// CommonJS variant of the no-op `prettier/standalone` stub.
async function format(source) {
  return source;
}
module.exports = { format, default: { format } };
