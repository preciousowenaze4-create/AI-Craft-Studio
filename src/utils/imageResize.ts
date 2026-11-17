import type { ChatImageAttachment } from '../types';

const MAX_EDGE_PX = 1280;
const JPEG_QUALITY = 0.84;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to read image file'));
      }
    };
    reader.onerror = () => reject(new Error('Unable to read image file'));
    reader.readAsDataURL(file);
  });
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Unsupported or corrupted image file'));
    img.src = src;
  });
}

export async function processImageFile(file: File): Promise<ChatImageAttachment> {
  if (!file.type.startsWith('image/')) {
    throw new Error(`"${file.name}" is not a supported image file.`);
  }

  const rawDataUrl = await readFileAsDataUrl(file);
  const img = await loadImageElement(rawDataUrl);

  const origW = img.naturalWidth || img.width || 512;
  const origH = img.naturalHeight || img.height || 512;

  const scale = Math.min(1, MAX_EDGE_PX / Math.max(origW, origH));
  const targetW = Math.max(1, Math.round(origW * scale));
  const targetH = Math.max(1, Math.round(origH * scale));

  // Always normalize to clean canvas JPEG/PNG so vision APIs accept any browser format (HEIC/WebP/PNG/JPG)
  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return {
      id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: file.name || 'image.jpg',
      mimeType: file.type || 'image/jpeg',
      dataUrl: rawDataUrl,
      width: origW,
      height: origH,
    };
  }

  // Fill dark neutral background behind transparent PNGs before JPEG compression only if converting to JPEG
  const keepPng = file.type === 'image/png' && rawDataUrl.length < 320_000 && scale === 1;
  if (!keepPng) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetW, targetH);
  }
  ctx.drawImage(img, 0, 0, targetW, targetH);

  const outputMime = keepPng ? 'image/png' : 'image/jpeg';
  const compressedUrl = keepPng
    ? canvas.toDataURL('image/png')
    : canvas.toDataURL('image/jpeg', JPEG_QUALITY);

  return {
    id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: file.name || 'upload.jpg',
    mimeType: outputMime,
    dataUrl: compressedUrl,
    width: targetW,
    height: targetH,
  };
}
