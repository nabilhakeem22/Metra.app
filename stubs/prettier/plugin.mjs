// No-op stand-in for `prettier/plugins/html`. Shape mirrors a prettier plugin
// so `import * as html from 'prettier/plugins/html'` resolves; it is never
// actually invoked because format() (above) is a no-op.
const plugin = { languages: [], parsers: {}, printers: {} };
export default plugin;
export const languages = plugin.languages;
export const parsers = plugin.parsers;
export const printers = plugin.printers;
