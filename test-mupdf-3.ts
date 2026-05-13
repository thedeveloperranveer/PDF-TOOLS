import * as mupdf from "mupdf";
import fs from "fs";
import { PDFDocument } from "pdf-lib";

async function run() {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.addPage([500, 500]);
  const bytes = await pdfDoc.save();
  const doc = mupdf.Document.openDocument(bytes, "application/pdf");
  const page = doc.loadPage(0);
  const pixmap = page.toPixmap(mupdf.Matrix.scale(1, 1), mupdf.ColorSpace.DeviceRGB, true);
  
  console.log("Pixmap methods/properties:", Object.keys(pixmap), Object.getPrototypeOf(pixmap));
}
run();
