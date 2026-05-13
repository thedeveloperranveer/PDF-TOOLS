import * as mupdf from "mupdf";
import fs from "fs";
import { PDFDocument } from "pdf-lib";

async function run() {
  const pdfDoc = await PDFDocument.create();
  for (let i = 0; i < 5; i++) {
     pdfDoc.addPage([500, 500]).drawText("Page " + i, {x: 50, y: 50});
  }
  const bytes = await pdfDoc.save();
  
  const doc = mupdf.Document.openDocument(bytes, "application/pdf");
  console.log("Pages:", doc.countPages());
  const page = doc.loadPage(0);
  const pixmap = page.toPixmap(mupdf.Matrix.scale(1, 1), mupdf.ColorSpace.DeviceRGB, true);
  console.log("Pixmap size:", pixmap.getWidth(), pixmap.getHeight());
  
  // Can we modify pixmap pixels?
  const pixels = pixmap.getPixels();
  console.log("Pixels array:", typeof pixels, pixels.length);
  
  // Save to image? 
  // Wait, pdf-lib can embed JPG/PNG. 
}
run();
