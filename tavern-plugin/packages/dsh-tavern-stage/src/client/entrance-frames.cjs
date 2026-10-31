function entrancePlateFrames(files, ahead, bitmap = createImageBitmap) {
    const decoded = new Map(), pending = new Set(), failed = new Set(), options = {premultiplyAlpha: 'none', colorSpaceConversion: 'none'};
    let disposed = false;
    const close = frame => { frame.color.close(); if (frame.shift) frame.shift.close(); };
    function decode(i) {
        if (disposed || i >= files.color.length || decoded.has(i) || pending.has(i) || failed.has(i)) return;
        pending.add(i);
        Promise.allSettled([Promise.resolve().then(()=>bitmap(files.color[i], options)), files.shift ? Promise.resolve().then(()=>bitmap(files.shift[i], options)) : null]).then(results => {
            const [color,shift]=results.map(result=>result.status==='fulfilled'?result.value:null);
            if(results.some(result=>result.status==='rejected')) {
                color?.close();shift?.close();pending.delete(i);failed.add(i);return;
            }
            pending.delete(i);
            if (disposed) close({color, shift}); else decoded.set(i, {color, shift});
        }, () => { pending.delete(i); failed.add(i); });
    }
    return {
        want(index) {
            if(disposed)return null;
            for (const [i, frame] of decoded) if (i < index) { close(frame); decoded.delete(i); }
            for (let i = index; i < index + ahead; i++) decode(i);
            return decoded.get(index) || null;
        },
        dispose() { disposed = true; decoded.forEach(close); decoded.clear(); }
    };
}


if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={entrancePlateFrames};
