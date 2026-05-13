const fs = require('fs');
const { PDFDocument } = require('pdf-lib');

async function run() {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 10; i++) {
    const page = doc.addPage([500, 500]);
    page.drawText('Hello page ' + i, { x: 50, y: 50 });
  }
  const bytes = await doc.save();
  fs.writeFileSync('dummy.pdf', bytes);
  console.log('Created dummy.pdf');
}
run();
