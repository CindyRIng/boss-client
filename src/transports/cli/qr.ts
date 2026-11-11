/**
 * 终端二维码渲染（PNG → ANSI 半块字符）
 */
import { PNG } from 'pngjs';

function toBlackWhite(dataUrlOrBase64: string): PNG {
  const b64 = dataUrlOrBase64.includes(',') ? dataUrlOrBase64.split(',')[1]! : dataUrlOrBase64;
  return PNG.sync.read(Buffer.from(b64, 'base64'));
}

export function renderQrTerminal(dataUrlOrBase64: string, maxCols = 52): string {
  const png = toBlackWhite(dataUrlOrBase64);
  const { width, height, data } = png;
  const stepX = Math.max(1, Math.ceil(width / maxCols));
  const stepY = stepX;
  const cols = Math.ceil(width / stepX);
  const rows = Math.ceil(height / stepY);
  const isBlack = (x: number, y: number): boolean => {
    const px = Math.min(width - 1, Math.max(0, x));
    const py = Math.min(height - 1, Math.max(0, y));
    const i = (py * width + px) * 4;
    const r = data[i] ?? 255;
    const g = data[i + 1] ?? 255;
    const b = data[i + 2] ?? 255;
    const a = data[i + 3] ?? 255;
    if (a < 32) return false;
    return (r * 0.299 + g * 0.587 + b * 0.114) < 128;
  };
  let out = '';
  for (let y = 0; y < rows; y += 2) {
    for (let x = 0; x < cols; x += 1) {
      const top = isBlack(x * stepX + Math.floor(stepX / 2), y * stepY + Math.floor(stepY / 2));
      const bottomY = Math.min(rows - 1, y + 1);
      const bottom = isBlack(x * stepX + Math.floor(stepX / 2), bottomY * stepY + Math.floor(stepY / 2));
      const fg = top ? '0;0;0' : '255;255;255';
      const bg = bottom ? '0;0;0' : '255;255;255';
      out += `\x1b[38;2;${fg}m\x1b[48;2;${bg}m\u2580`;
    }
    out += '\x1b[0m\n';
  }
  return out;
}
