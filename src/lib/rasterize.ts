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
  
  // Reuse a SINGLE canvas to prevent exceeding browser canvas limits.
  // willReadFrequently forces software rendering, avoiding GPU VRAM exhaustion (black pages)
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not create canvas context');
  
  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const page = await pdfSource.getPage(pageNum);
    
    // Scale for rendering
    let scale = 1.5; 
    let viewport = page.getViewport({ scale });
    
    // Safety check: Prevent massive memory consumption per page
    // Keep max theoretical pixels under ~2.5 MP to prevent black renders on low RAM devices
    const MAX_PIXELS = 2500000;
    if (viewport.width * viewport.height > MAX_PIXELS) {
        const baseViewport = page.getViewport({ scale: 1 });
        scale = Math.sqrt(MAX_PIXELS / (baseViewport.width * baseViewport.height));
        viewport = page.getViewport({ scale });
    }
    
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    
    // Fill white background to prevent transparent areas from becoming black in JPEG
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
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
    
    // Use toBlob instead of toDataURL to prevent massive memory usage strings
    const jpegBytes = await new Promise<Uint8Array>((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (!blob) return reject(new Error('Canvas toBlob failed'));
            blob.arrayBuffer().then(buf => resolve(new Uint8Array(buf))).catch(reject);
        }, 'image/jpeg', 0.85);
    });
    
    const jpgImage = await newPdf.embedJpg(jpegBytes);
    
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
    
    // Small delay to allow Javascript garbage collector to clean up memory
    await new Promise(r => setTimeout(r, 20));

    onProgress(Math.round((pageNum / totalPages) * 100));
  }
  
  canvas.width = 0;
  canvas.height = 0;
  await loadingTask.destroy();
  
  return await newPdf.save();
}
