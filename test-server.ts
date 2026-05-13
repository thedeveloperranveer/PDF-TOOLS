import fs from 'fs';
import { PDFDocument } from 'pdf-lib';

async function run() {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 10; i++) {
    const page = doc.addPage([500, 500]);
    page.drawText('Hello page ' + i, { x: 50, y: 50 });
  }
  const bytes = await doc.save();
  
  const FormData = (await import('formdata-node')).FormData;
  const { fileFromPathSync } = await import('formdata-node/file-from-path');
  // wait we can just construct multipart manually
}
run();
