function encodeBytesToBase64(bytes) {
    let binary = "";
    const step = 8192;
    for (let i = 0; i < bytes.length; i += step) {
        const slice = bytes.subarray(i, Math.min(i + step, bytes.length));
        binary += String.fromCharCode.apply(null, slice);
    }
    return btoa(binary);
}

function readBlobAsUint8Array(blob) {
    if (blob && typeof blob.arrayBuffer === "function") {
        return blob.arrayBuffer().then(function (buf) { return new Uint8Array(buf); });
    }
    return new Promise(function (resolve, reject) {
        const reader = new FileReader();
        reader.onload = function () { resolve(new Uint8Array(reader.result)); };
        reader.onerror = function () { reject(reader.error || new Error("读取导出数据失败")); };
        reader.readAsArrayBuffer(blob);
    });
}

function downloadTavernBlobViaNativeBridge(bridge, blob, filename) {
    const name = filename || "dsh-tavern-download";
    const mime = (blob && blob.type) || "";
    return readBlobAsUint8Array(blob).then(function (bytes) {
        const id = bridge.begin(name, mime);
        if (!id) return false;
        try {
            // 每块 384 KB（3 的倍数，base64 恰好 512 KB），避免单次 JNI 字符串过大。
            const chunkSize = 393216;
            for (let i = 0; i < bytes.length; i += chunkSize) {
                const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
                if (!bridge.chunk(id, encodeBytesToBase64(chunk))) {
                    throw new Error("写入下载文件失败");
                }
            }
            return Boolean(bridge.finish(id));
        } catch (err) {
            try { bridge.abort(id, String(err && err.message || err)); } catch (_ignored) {}
            return false;
        }
    }).catch(function () {
        return false;
    });
}

function downloadTavernBlob(blob, filename) {
    const bridge = typeof window !== "undefined" ? window.DshNativeDownload : null;
    if (bridge && typeof bridge.begin === "function" && typeof bridge.chunk === "function" && typeof bridge.finish === "function") {
        void downloadTavernBlobViaNativeBridge(bridge, blob, filename);
        return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    try {
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
    } finally {
        link.remove();
        // Give the browser time to consume the URL before releasing its bytes.
        window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }
}
