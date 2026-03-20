const fs = require('fs');
const http = require('http');

const data = JSON.stringify({ searchType: 'refno', searchValue: '16152320400372' });

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/get-bill',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

const req = http.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => {
    try {
      const parsed = JSON.parse(body);
      if (parsed.success && parsed.image) {
        fs.writeFileSync('test_bill.png', Buffer.from(parsed.image, 'base64'));
        console.log('SUCCESS: Saved test_bill.png');
      } else {
        console.error('Server returned error:', parsed);
      }
    } catch (e) {
      console.error('Failed to parse response:', e);
    }
  });
});

req.on('error', (e) => console.error(e));
req.write(data);
req.end();
