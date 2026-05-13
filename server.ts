import express from "express";
import path from "path";
import multer from "multer";
import { PDFDocument } from 'pdf-lib';
import * as mupdf from "mupdf";
import sharp from "sharp";

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
      
      const fileBytes = req.file.buffer;
      
      // Load source PDF with mupdf (WASM) - extremely fast and memory efficient
      const doc = mupdf.Document.openDocument(fileBytes, "application/pdf");
      const totalPages = doc.countPages();

      const newPdf = await PDFDocument.create();

      for (let pageNum = 0; pageNum < totalPages; pageNum++) {
        const page = doc.loadPage(pageNum);
        
        // Scale 3.0x for High Quality (~300 DPI equivalent)
        const scaleLayer = 3.0; // Dynamic scale layer
        const scaleMatrix = mupdf.Matrix.scale(scaleLayer, scaleLayer);
        const pixmap = page.toPixmap(scaleMatrix, mupdf.ColorSpace.DeviceRGB, true);
        
        let pixels = pixmap.getPixels();
        const width = pixmap.getWidth();
        const height = pixmap.getHeight();

        if (applyFilters) {
          // Mutate the typed array directly
          for (let i = 0; i < pixels.length; i += 4) {
            let r = pixels[i]; let g = pixels[i + 1]; let b = pixels[i + 2];
            
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

            pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b;
          }
        }

        // Use sharp (libvips) to encode jpeg. Fast and no Canvas limits.
        const buffer = await sharp(pixels, {
          raw: {
            width: width,
            height: height,
            channels: 4,
          }
        }).jpeg({ quality: 95 }).toBuffer(); // boosted quality to 95

        const jpgImage = await newPdf.embedJpg(buffer);

        // Add back to PDF with exact logical boundaries
        const logicalWidth = width / scaleLayer;
        const logicalHeight = height / scaleLayer;

        const newPage = newPdf.addPage([logicalWidth, logicalHeight]);
        newPage.drawImage(jpgImage, {
          x: 0,
          y: 0,
          width: logicalWidth,
          height: logicalHeight,
        });
      }

      const finalPdfBytes = await newPdf.save();
      
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
