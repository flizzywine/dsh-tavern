export type TextEncoding = 'utf8' | 'utf8-bom' | 'utf16le' | 'utf16le-bom' | 'utf16be' | 'utf16be-bom' | 'utf32le-bom' | 'utf32be-bom' | 'gbk' | 'gb18030';
export interface DecodedText {
    content: string;
    encoding: TextEncoding;
}
/**
 * Line-ending style a save must round-trip. Only CRLF is recognized: a lone
 * `\r` (classic Mac) is neither counted by {@link detectEol} nor rewritten by
 * {@link restoreEol}, which mirrors the host filesystem backend
 * (`@deepseek-ai/dsh-fs-local`). Its `edit` tool is the reference behaviour
 * here — it restores the style detected at read time instead of normalizing the
 * file, so a model edit does not rewrite every line. The host's `write` tool
 * does NOT do this (it writes the model's LF text verbatim), which is why the
 * editor's own save has to carry the guarantee itself.
 */
export type TextEol = 'lf' | 'crlf';
/** The on-disk format of a file: how its bytes are encoded and how its lines
 *  end. Both are re-detected from disk before every save. */
export interface FileFormat {
    encoding: TextEncoding;
    eol: TextEol;
}
/**
 * Decode a text buffer, or `null` when it looks binary (NUL-bearing and not
 * UTF-16/32). `truncated` says the buffer is a prefix of a larger file, which
 * lets a read cap cut mid-character without flipping the detected encoding.
 */
export declare function decodeTextBytes(bytes: Buffer, truncated?: boolean): DecodedText | null;
/**
 * Whether an encoding stores one character as a fixed-width code unit, and
 * whether that unit is little-endian. `1` covers every byte-oriented encoding
 * (UTF-8, GBK, GB18030), where a `\n` byte is unambiguous.
 */
export declare function unitWidth(encoding: TextEncoding): 1 | 2 | 4;
/**
 * Whether one byte is a whole character or part of one.
 *
 * The paged reader needs exactly this distinction and nothing finer: a
 * byte-oriented encoding can be re-sniffed per window safely (a pure-ASCII
 * window of a GBK document decodes identically either way), while a wide
 * encoding is a property of the FILE and must not be re-litigated by a window
 * that happens to contain no NUL bytes.
 *
 * @param encoding - an encoding a window detected.
 * @returns true for UTF-16 / UTF-32 in either byte order.
 */
export declare function isWideEncoding(encoding: TextEncoding): boolean;
/**
 * The byte offset just past the LAST complete line break in `bytes`, or `-1`
 * when the window holds none.
 *
 * A byte-oriented search would be wrong for the wide encodings: in UTF-16LE the
 * low byte of U+0A41 is `0x0A`, so a naive `lastIndexOf(0x0A)` cuts a character
 * in half. The search therefore only accepts a `0x0A` sitting in the unit
 * position a U+000A code point would occupy — the first byte of a little-endian
 * unit, the last byte of a big-endian one — and reports the end of that unit.
 *
 * @param bytes - the window just read.
 * @param encoding - the encoding {@link decodeTextAs} will use for it.
 * @returns an offset into `bytes`, or `-1` when the window has no line break.
 */
export declare function lastLineBreakEnd(bytes: Buffer, encoding: TextEncoding): number;
/**
 * Decode a buffer UNDER A KNOWN ENCODING, without sniffing.
 *
 * {@link decodeTextBytes} answers "what is this file?" from the bytes alone,
 * which is the wrong question for the second page of a paged read: a page that
 * happens to be pure ASCII sniffs as UTF-8 while a GBK page of the same
 * document sniffs as GBK, and concatenating the two yields mojibake. The paged
 * reader sniffs once and decodes every later window with this.
 *
 * BOM handling stays with the caller: `*-bom` encodings describe the file's
 * first bytes, so a caller reading from a non-zero offset should pass the
 * BOM-less spelling (see `bomlessEncoding`).
 *
 * @param bytes - the window to decode (already known to be text).
 * @param encoding - the encoding the first window established.
 * @returns the decoded text; undecodable bytes fall back to UTF-8, matching
 *  {@link decodeTextBytes}'s replacement-character behavior.
 */
export declare function decodeTextAs(bytes: Buffer, encoding: TextEncoding): string;
/**
 * The same encoding minus its BOM marker, for windows that do not start at the
 * beginning of the file (only offset 0 can carry a BOM).
 *
 * @param encoding - an encoding an earlier window detected.
 * @returns the BOM-less spelling (unchanged for encodings that have none).
 */
export declare function bomlessEncoding(encoding: TextEncoding): TextEncoding;
export declare function encodeText(text: string, encoding: TextEncoding): Buffer;
/**
 * Majority vote over the leading {@link EOL_SNIFF_LIMIT} characters: CRLF wins
 * only when the CRLF pairs outnumber the bare LFs. A file with a single trailing
 * CRLF among many LF lines therefore reads as LF, and a `\r`-only (classic Mac)
 * file reads as LF without its bytes being touched — both the same verdict the
 * host backend reaches, so a plugin save and a model `edit` agree.
 */
export declare function detectEol(text: string): TextEol;
/**
 * Convert the editor's LF document back to the file's own style before
 * encoding. CRLF content is normalized first (unlike a naive `split('\n').join`
 * this can never turn an existing pair into `\r\r\n`) — the same guard the host
 * backend's `restoreLineEndings` documents. Everything else, including a lone
 * `\r`, is passed through untouched.
 */
export declare function restoreEol(text: string, eol: TextEol): string;
/**
 * Detect the on-disk format a save has to round-trip: byte encoding AND line
 * endings, from one sniff read. Called before the temp write on every save, so
 * the editor never silently converts GBK / UTF-16 / BOM'd UTF-8 bytes — nor a
 * CRLF file to LF, which for a one-line edit would land as a whole-file diff
 * (#871). A missing file yields UTF-8 + LF (see the comment below).
 */
export declare function fileFormatOf(path: string): Promise<FileFormat>;
