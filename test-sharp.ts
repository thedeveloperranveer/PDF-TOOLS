import * as mupdf from "mupdf";
import fs from "fs";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";

async function run() {
  const pdfDoc = await PDFDocument.create();
  const pdfPage = pdfDoc.addPage([500, 500]);
  pdfPage.drawText("Test String ABC", { x: 50, y: 50 });
  const bytes = await pdfDoc.save();
  
  const doc = mupdf.Document.openDocument(bytes, "application/pdf");
  const page = doc.loadPage(0);
  const pixmap = page.toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB, true);
  
  console.log("Width:", pixmap.getWidth(), "Height:", pixmap.getHeight());
  
  const pixels = pixmap.getPixels();
  
  // Invert pixels!
  for(let i = 0; i < pixels.length; i += 4) {
     pixels[i] = 255 - pixels[i];
     pixels[i+1] = 255 - pixels[i+1];
     pixels[i+2] = 255 - pixels[i+2];
     // keep alpha
  }
  
  const jpegBuffer = await sharp(pixels, {
    raw: {
      width: pixmap.getWidth(),
      height: pixmap.getHeight(),
      channels: 4,
    }
  }).jpeg({ quality: 85 }).toBuffer();
  
  fs.writeFileSync('output.jpg', jpegBuffer);
  console.log("Written output.jpg");
}
run();
