// The ONE HTML escaper for the email templates. It was copied into three of them,
// which is how two of the copies came to be applied to the body text but not to
// the URL interpolated into href="…" — a URL containing a double quote closed the
// attribute and let the rest of it become markup.
//
// Escapes the five characters that matter inside both element text and a quoted
// attribute value. The single quote is included (as &#39;, the numeric form,
// because &apos; is not in the HTML4 entity set some mail clients parse) so the
// same function is safe for a single-quoted attribute too. Plain-text email
// bodies are NOT escaped: there is no markup there and an escaped ampersand in a
// plain-text link is a broken link.
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
