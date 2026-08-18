// No-op stand-in for the `prettier` entrypoint. See package.json for why.
export async function format(source) {
  return source;
}
export default { format };
