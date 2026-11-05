const https = require('https');
const fs = require('fs');
const path = require('path');

const files = [
  {
    url: 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.6/dist/umd/supabase.min.js',
    filename: 'supabase.min.js'
  },
  {
    url: 'https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.1.6/purify.min.js',
    filename: 'purify.min.js'
  },
  {
    url: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    filename: 'jspdf.umd.min.js'
  }
];

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        // Follow redirect
        return download(response.headers.location, dest).then(resolve).catch(reject);
      }
      if (response.statusCode !== 200) {
        return reject(new Error(`Failed to get '${url}' (${response.statusCode})`));
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close(() => resolve(dest));
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => reject(err));
    });
  });
}

async function main() {
  const dirs = [
    path.join(__dirname, '..', 'www', 'vendor'),
    path.join(__dirname, '..', 'vendor')
  ];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  for (const item of files) {
    console.log(`Downloading ${item.filename} from ${item.url}...`);
    const tempDest = path.join(__dirname, '..', 'www', 'vendor', item.filename);
    await download(item.url, tempDest);
    console.log(`Downloaded ${item.filename} (${fs.statSync(tempDest).size} bytes)`);
    // Copy to the other vendor dir
    fs.copyFileSync(tempDest, path.join(__dirname, '..', 'vendor', item.filename));
  }

  console.log('All vendor libraries successfully bundled locally!');
}

main().catch(err => {
  console.error('Download error:', err);
  process.exit(1);
});
