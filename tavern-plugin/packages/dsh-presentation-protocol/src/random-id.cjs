// 客户端随机 id 的唯一实现。crypto.randomUUID 只在安全上下文（https、localhost）存在；
// 手机用 http://局域网 IP 打开时没有它，这里用任何上下文都有的 crypto.getRandomValues 拼同格式的 UUID v4。
function randomId(crypto = globalThis.crypto) {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = { randomId };
