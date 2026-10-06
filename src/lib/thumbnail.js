export async function createThumbnail(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = 'async';
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { image.src = ''; reject(new Error('Cover decoding timed out.')); }, 15000);
      image.onload = () => { clearTimeout(timeout); resolve(); };
      image.onerror = () => { clearTimeout(timeout); reject(new Error('Cover decoding failed.')); };
      image.src = url;
    });
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (!width || !height || width * height > 36000000 || Math.max(width, height) > 12000) {
      throw new Error('The cover dimensions are not supported.');
    }
    const scale = Math.min(1, 360 / width, 540 / height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not create a cover thumbnail.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) =>
      canvas.toBlob((thumbnail) => thumbnail ? resolve(thumbnail) : reject(new Error('Could not save the thumbnail.')), 'image/jpeg', 0.84),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
