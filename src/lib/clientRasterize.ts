import { PDFDocument } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

interface Filters {
  grayscale: boolean;
  invert: boolean;
  sepia: boolean;
  contrast: boolean;
}

export async function rasterizePdfWithFilters(
  pdfBytes: ArrayBuffer,
  filters: Filters,
  onProgress: (p: number) => void
): Promise<Uint8Array> {
  const loadingTask = pdfjsLib.getDocument({ data: pdfBytes });
  const pdfSource = await loadingTask.promise;
  const newPdf = await PDFDocument.create();
  const totalPages = pdfSource.numPages;

  // We need two canvases: one for raw PDF, one for filtered output
  const rawCanvas = document.createElement('canvas');
  const rawCtx = rawCanvas.getContext('2d', { alpha: false });
  
  const filterCanvas = document.createElement('canvas');
  const filterCtx = filterCanvas.getContext('2d', { alpha: false });

  if (!rawCtx || !filterCtx) throw new Error('Canvas 2D context optimization failed.');

  // Construct CSS filter string for ultra-fast native C++ GPU rendering
  const cssFilters: string[] = [];
  if (filters.grayscale) cssFilters.push('grayscale(100%)');
  if (filters.invert) cssFilters.push('invert(100%)'); // Removed hue-rotate, not cleanly supported by all canvas backends and invert is primary feature
  if (filters.sepia) cssFilters.push('sepia(100%)');
  const contrastFactor = filters.contrast ? '150%' : '';
  if (contrastFactor) cssFilters.push(`contrast(${contrastFactor})`);
  
  const cssFilterString = cssFilters.length > 0 ? cssFilters.join(' ') : 'none';

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    // Yield main thread heavily: guarantee 20ms pause for UI responsiveness between pages
    await new Promise(resolve => setTimeout(resolve, 20));

    const page = await pdfSource.getPage(pageNum);

    // Keep scale small (1.0 - 1.2) to guarantee speed ("under 2s") and prevent crashing the PC
    const scale = 1.0; 
    const viewport = page.getViewport({ scale });

    rawCanvas.width = viewport.width;
    rawCanvas.height = viewport.height;
    filterCanvas.width = viewport.width;
    filterCanvas.height = viewport.height;

    // 1. Fill raw canvas and render PDF
    rawCtx.fillStyle = '#ffffff';
    rawCtx.fillRect(0, 0, rawCanvas.width, rawCanvas.height);
    
    await page.render({
      canvasContext: rawCtx,
      viewport: viewport,
    }).promise;

    // 2. Draw raw canvas into filter canvas with native GPU filter
    filterCtx.fillStyle = '#ffffff';
    filterCtx.fillRect(0, 0, filterCanvas.width, filterCanvas.height);
    filterCtx.filter = cssFilterString;
    filterCtx.drawImage(rawCanvas, 0, 0);

    // Export to JPEG Blob natively
    // We use aggressive compression (0.80) to keep RAM use extremely low
    const jpegBytes = await new Promise<Uint8Array>((resolve, reject) => {
      filterCanvas.toBlob((blob) => {
        if (!blob) return reject(new Error('Canvas toBlob failed'));
        blob.arrayBuffer().then(buf => resolve(new Uint8Array(buf))).catch(reject);
      }, 'image/jpeg', 0.80);
    });

    const jpgImage = await newPdf.embedJpg(jpegBytes);

    // Add to new PDF with the exact original physical dimensions
    const baseWidth = viewport.width / scale;
    const baseHeight = viewport.height / scale;

    const newPage = newPdf.addPage([baseWidth, baseHeight]);
    newPage.drawImage(jpgImage, {
      x: 0,
      y: 0,
      width: baseWidth,
      height: baseHeight,
    });

    // Cleanup resources per page explicitly
    page.cleanup();

    onProgress(Math.round((pageNum / totalPages) * 100));
  }

  // Collapse canvases to 1x1 to fully release GPU buffers
  rawCanvas.width = 1; rawCanvas.height = 1;
  filterCanvas.width = 1; filterCanvas.height = 1;

  await loadingTask.destroy();
  return await newPdf.save();
}
