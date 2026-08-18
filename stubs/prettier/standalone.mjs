// No-op stand-in for `prettier/standalone`. `format` returns its input
// unchanged. @react-email/render only calls this when pretty-printing rendered
// HTML, which this app never does (it sends plain-HTML email strings).
export async function format(source) {
  return source;
}
export default { format };
