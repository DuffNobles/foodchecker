// Browser only. Shrink a photo on the phone first: longest side 1568 px, JPEG. Keeps the upload small and fast.
export function prepare(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const src = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, 1568 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(src);
      c.toBlob((blob) => {
        if (!blob) return reject(new Error('no blob'));
        const fr = new FileReader();
        fr.onload = () => resolve({ b64: String(fr.result).split(',')[1], url: URL.createObjectURL(blob) });
        fr.onerror = reject;
        fr.readAsDataURL(blob);
      }, 'image/jpeg', 0.85);
    };
    img.onerror = () => reject(new Error('bad image'));
    img.src = src;
  });
}
