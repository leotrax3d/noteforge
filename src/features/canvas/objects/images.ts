const MAX_SIDE = 2000;

export interface LoadedImage {
  src: string;
  w: number;
  h: number;
}

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error("Bild konnte nicht geladen werden"));
    img.src = src;
  });
}

/** Bild verkleinern (max. 2000 px) und als Data-URL kodieren. */
export async function encodeImage(source: CanvasImageSource & { width: number; height: number }, photo: boolean): Promise<LoadedImage> {
  const k = Math.min(1, MAX_SIDE / Math.max(source.width, source.height));
  const w = Math.max(1, Math.round(source.width * k)), h = Math.max(1, Math.round(source.height * k));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  c.getContext("2d")!.drawImage(source, 0, 0, w, h);
  const src = photo ? c.toDataURL("image/jpeg", 0.9) : c.toDataURL("image/png");
  return { src, w, h };
}

export async function fileToImage(file: Blob): Promise<LoadedImage> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImg(url);
    return await encodeImage(img, file.type === "image/jpeg");
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Bildschirm/Fenster einmal aufnehmen (getDisplayMedia) und als Canvas liefern. */
export async function captureScreen(): Promise<HTMLCanvasElement> {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const c = document.createElement("canvas");
    c.width = video.videoWidth;
    c.height = video.videoHeight;
    c.getContext("2d")!.drawImage(video, 0, 0);
    video.pause();
    return c;
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}
