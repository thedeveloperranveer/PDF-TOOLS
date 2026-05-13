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

export async function rasterizePdfWithFilters(pdfBytes: ArrayBuffer, filters: Filters, onProgress: (p: number) => void): Promise<Uint8Array> {
  const loadingTask = pdfjsLib.getDocument({ data: pdfBytes });
  const pdfSource = await loadingTask.promise;
  
  const newPdf = await PDFDocument.create();
  const totalPages = pdfSource.numPages;
  
  // Reuse a single canvas for all pages to prevent memory leaks/black pages
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not create canvas context');
  
  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const page = await pdfSource.getPage(pageNum);
    
    // Scale for rendering (2.0 gives good quality balance, 3.0 gives better text but larger file)
    const scale = 2.0; 
    const viewport = page.getViewport({ scale });
    
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    
    const renderContext = {
      canvasContext: ctx,
      viewport: viewport,
    };
    
    await page.render(renderContext).promise;
    
    // Apply filters
    if (filters.grayscale || filters.invert || filters.sepia || filters.contrast) {
       const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
       const data = imgData.data;
       
       for(let i = 0; i < data.length; i += 4) {
          let r = data[i];
          let g = data[i+1];
          let b = data[i+2];
          
          if (filters.grayscale) {
             const avg = 0.3 * r + 0.59 * g + 0.11 * b;
             r = avg; g = avg; b = avg;
          }
          if (filters.sepia) {
             const tr = Math.min(255, (r * 0.393) + (g * 0.769) + (b * 0.189));
             const tg = Math.min(255, (r * 0.349) + (g * 0.686) + (b * 0.168));
             const tb = Math.min(255, (r * 0.272) + (g * 0.534) + (b * 0.131));
             r = tr; g = tg; b = tb;
          }
          if (filters.invert) {
             r = 255 - r;
             g = 255 - g;
             b = 255 - b;
          }
          if (filters.contrast) {
             // 150% contrast
             const factor = (259 * (128 + 255)) / (255 * (259 - 128));
             r = Math.max(0, Math.min(255, factor * (r - 128) + 128));
             g = Math.max(0, Math.min(255, factor * (g - 128) + 128));
             b = Math.max(0, Math.min(255, factor * (b - 128) + 128));
          }
          
          data[i] = r;
          data[i+1] = g;
          data[i+2] = b;
       }
       ctx.putImageData(imgData, 0, 0);
    }
    
    // Save image
    const base64Jpeg = canvas.toDataURL('image/jpeg', 0.85);
    const jpgImage = await newPdf.embedJpg(base64Jpeg);
    
    // Add to new PDF with the ORIGINAL page dimensions
    const newPage = newPdf.addPage([viewport.width / scale, viewport.height / scale]);
    newPage.drawImage(jpgImage, {
      x: 0,
      y: 0,
      width: viewport.width / scale,
      height: viewport.height / scale,
    });

    // Cleanup resources for this page
    page.cleanup();
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    onProgress(Math.round((pageNum / totalPages) * 100));
  }
  
  // Free the canvas memory explicitly
  canvas.width = 0;
  canvas.height = 0;
  await loadingTask.destroy();
  
  return await newPdf.save();
}
