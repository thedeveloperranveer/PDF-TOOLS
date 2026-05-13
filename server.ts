import express from "express";
import path from "path";
import multer from "multer";
import { PDFDocument } from 'pdf-lib';
// Use legacy build for Node.js compatibility
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from "canvas"; // Native canvas for Node

const upload = multer({ storage: multer.memoryStorage() });

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Add JSON parsing middleware
  app.use(express.json());

  // API constraints check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // End point for processing PDF
  app.post("/api/process-pdf", upload.single("pdf"), async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "No PDF file provided." });
    }

    try {
      const filters = JSON.parse(req.body.filters || '{}');
      const applyFilters = filters.grayscale || filters.invert || filters.sepia || filters.contrast;
      
      const fileBytes = new Uint8Array(req.file.buffer);
      
      // Load source PDF with pdf.js
      const loadingTask = pdfjsLib.getDocument({ data: fileBytes });
      const pdfSource = await loadingTask.promise;
      const totalPages = pdfSource.numPages;

      const newPdf = await PDFDocument.create();
      
      // Reuse native canvas
      let canvas: any = null;
      let ctx: any = null;

      for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        const page = await pdfSource.getPage(pageNum);
        
        // Scale for rendering, bound by max pixels to prevent OOM
        let scale = 2.0; 
        let viewport = page.getViewport({ scale });
        
        const MAX_PIXELS = 4000000; // ~4 MP limit for server rasterization
        if (viewport.width * viewport.height > MAX_PIXELS) {
            const baseViewport = page.getViewport({ scale: 1 });
            scale = Math.sqrt(MAX_PIXELS / (baseViewport.width * baseViewport.height));
            viewport = page.getViewport({ scale });
        }

        if (!canvas) {
           canvas = createCanvas(viewport.width, viewport.height);
           ctx = canvas.getContext("2d");
        } else {
           canvas.width = viewport.width;
           canvas.height = viewport.height;
        }

        // Fill white background natively
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const renderContext = {
          canvasContext: ctx,
          viewport: viewport,
        };

        await page.render(renderContext).promise;

        if (applyFilters) {
          const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const data = imgData.data;

          for (let i = 0; i < data.length; i += 4) {
            let r = data[i]; let g = data[i + 1]; let b = data[i + 2];
            
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
               r = 255 - r; g = 255 - g; b = 255 - b;
            }
            if (filters.contrast) {
               const factor = (259 * (128 + 255)) / (255 * (259 - 128));
               r = Math.max(0, Math.min(255, factor * (r - 128) + 128));
               g = Math.max(0, Math.min(255, factor * (g - 128) + 128));
               b = Math.max(0, Math.min(255, factor * (b - 128) + 128));
            }

            data[i] = r; data[i + 1] = g; data[i + 2] = b;
          }
          ctx.putImageData(imgData, 0, 0);
        }

        // Output to Buffer
        const buffer = canvas.toBuffer("image/jpeg", { quality: 0.85 });
        const jpgImage = await newPdf.embedJpg(buffer);

        const newPage = newPdf.addPage([viewport.width / scale, viewport.height / scale]);
        newPage.drawImage(jpgImage, {
          x: 0,
          y: 0,
          width: viewport.width / scale,
          height: viewport.height / scale,
        });

        page.cleanup(); // Clean up individual page
      }

      await loadingTask.destroy();
      const finalPdfBytes = await newPdf.save();
      
      // Return raw PDF binary to client
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", "attachment; filename=filtered.pdf");
      res.send(Buffer.from(finalPdfBytes));

    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
