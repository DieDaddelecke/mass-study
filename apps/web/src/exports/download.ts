/** Replace characters that are not allowed in file names; never returns an empty string. */
export function safeFileName(name: string, fallback = 'projet'): string {
  return name.trim().replace(/[\\/:*?"<>|]+/g, '_') || fallback;
}

/** Trigger a browser download of a blob. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
