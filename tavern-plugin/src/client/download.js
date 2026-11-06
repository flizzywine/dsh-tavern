function downloadTavernBlob(blob, filename) {
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
