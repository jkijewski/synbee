import type { CSSProperties } from 'react';
import type { Room } from './api';

// Room colours and photos (0012). Colours are soft tints over the page, so they work in light and dark mode.

export { PALETTE, roomColors } from '../../src/room-colors.js';

export const roomStyle = (color: string | undefined): CSSProperties => (color ? ({ '--room': color } as CSSProperties) : {});

export function RoomPhoto({ room, size = 32 }: { room: Pick<Room, 'id' | 'photo' | 'name'>; size?: number }) {
  if (!room.photo) return null;
  return (
    <a href={`/api/rooms/${room.id}/photo?size=mobile&v=${room.photo}`} target="_blank" rel="noreferrer" title={`Photo of ${room.name}`}>
      <img className="room-photo" src={`/api/rooms/${room.id}/photo?v=${room.photo}`} width={size} height={size} alt={`Photo of ${room.name}`} />
    </a>
  );
}

/**
 * Scales a picture in the browser before upload: a square 192 px thumbnail and at most 1080 px for phones, as WebP
 * (JPEG where the browser can't write WebP). Redrawing it applies the camera's rotation and leaves out all metadata,
 * including location.
 */
export async function preparePhoto(file: File): Promise<{ thumb: string; mobile: string }> {
  if (file.size > 20 * 1024 * 1024) throw new Error('The picture is larger than 20 MB');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('This picture format can’t be read here; use JPEG, PNG or WebP');
  }
  const encode = async (canvas: HTMLCanvasElement) => {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', 0.82));
    const final = blob && blob.type === 'image/webp' ? blob : await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
    if (!final) throw new Error('Could not process the picture');
    const bytes = new Uint8Array(await final.arrayBuffer());
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const draw = (w: number, h: number, sx: number, sy: number, sw: number, sh: number) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, w, h);
    return c;
  };
  const side = Math.min(bitmap.width, bitmap.height);
  const thumb = draw(192, 192, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side);
  const scale = Math.min(1, 1080 / Math.max(bitmap.width, bitmap.height));
  const mobile = draw(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale), 0, 0, bitmap.width, bitmap.height);
  return { thumb: await encode(thumb), mobile: await encode(mobile) };
}
