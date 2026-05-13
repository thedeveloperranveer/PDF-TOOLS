const fs = require('fs');
const http = require('http');
const FormData = require('form-data'); // we might not have it, let's use fetch

async function run() {
  const form = new FormData(); // wait, we don't have form-data. Let's make an ad-hoc multipart
}
run();
