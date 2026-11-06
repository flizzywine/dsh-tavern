// BOM takes precedence; UTF-8 is strict so legacy bytes never become replacement characters.
function decodeTextResource(buffer) {
  const bytes = new Uint8Array(buffer);
  const failure = () => new Error('无法识别文本编码或文件已损坏，请另存为 UTF-8 后重新导入');
  const decode = encoding => {
    const text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFD]/.test(text)) throw failure();
    return text;
  };
  // UTF-32 is not supported by browser TextDecoder; do not misidentify it as UTF-16.
  if ((bytes[0] === 0xff && bytes[1] === 0xfe && bytes[2] === 0 && bytes[3] === 0)
    || (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 0xfe && bytes[3] === 0xff)) throw failure();
  let encoding;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) encoding = 'utf-8';
  else if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le';
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be';
  if (encoding) {
    try { return decode(encoding); } catch { throw failure(); }
  }
  // Unmarked UTF-16 cannot be reliably distinguished from legacy Chinese encodings.
  // Refuse NUL-containing input rather than silently importing binary/UTF-16 as UTF-8.
  if (bytes.includes(0)) throw failure();
  try { return decode('utf-8'); } catch {}
  try { return decode('gb18030'); } catch { throw failure(); }
}

function parseTextResourceFile(file) {
  const name = String(file && file.name || '');
  if (!name.toLowerCase().endsWith('.epub')) {
    return file.arrayBuffer().then(buffer => ({ name, type: file.type || '', text: decodeTextResource(buffer), chunkSize: 500 }));
  }
  if (Number(file.size) > 50 * 1024 * 1024) return Promise.reject(new Error('EPUB 文件不能超过 50 MB'));
  return file.arrayBuffer().then(buffer => ({ name, type: file.type || 'application/epub+zip', fileB64: bytesToBase64(new Uint8Array(buffer)), chunkSize: 500 }));
}
