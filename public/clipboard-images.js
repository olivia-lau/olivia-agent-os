const extensions = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg'
};

export function imagesFromClipboard(clipboardData, timestamp = Date.now()) {
  const items = [...(clipboardData?.items || [])];
  const files = items.length
    ? items.filter(item => item.kind === 'file' && item.type?.startsWith('image/')).map(item => item.getAsFile()).filter(Boolean)
    : [...(clipboardData?.files || [])].filter(file => file.type?.startsWith('image/'));
  const stamp = new Date(timestamp).toISOString().replace(/[:.]/g, '-');
  return files.map((file, index) => ({
    file,
    relativePath: `Pasted-image-${stamp}-${index + 1}.${extensions[file.type] || 'image'}`
  }));
}
