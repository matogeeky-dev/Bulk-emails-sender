// Replaces {{name}} / {{Name}} / {{NAME}} placeholders with the recipient's
// name from the CSV. Falls back to "there" if the row had no name.
function renderTemplate(str, recipient) {
  if (!str) return '';
  const name = (recipient.name && recipient.name.trim()) || 'there';
  return str.replace(/\{\{\s*name\s*\}\}/gi, name);
}

function toHtml(plainText) {
  // Templates are entered/uploaded as plain text; convert line breaks to <br>
  // so paragraphs survive in the sent email.
  const escaped = plainText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped.replace(/\n/g, '<br>');
}

module.exports = { renderTemplate, toHtml };
