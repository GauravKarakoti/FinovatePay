const express = require('express');
const helmet = require('helmet');
const http = require('http');

// Create a simple Express app with helmet
const app = express();
app.use(helmet());

// Add a simple route
app.get('/', (req, res) => {
  res.json({ message: 'Server is running with helmet!' });
});

// Create server
const server = http.createServer(app);

// Start server on a test port
const TEST_PORT = 3999;
server.listen(TEST_PORT, async () => {
  console.log(`Test server running on port ${TEST_PORT}`);
  
  // Make a request to check headers
  const http = require('http');
  
  http.get(`http://localhost:${TEST_PORT}`, (res) => {
    console.log('\n=== Security Headers Response ===');
    console.log('Status:', res.statusCode);
    console.log('\nHeaders:');
    
    const securityHeaders = [
      'X-Content-Type-Options',
      'X-Frame-Options', 
      'X-XSS-Protection',
      'Strict-Transport-Security',
      'Content-Security-Policy',
      'Referrer-Policy',
      'Permissions-Policy'
    ];
    
    securityHeaders.forEach(header => {
      const value = res.headers[header.toLowerCase()];
      if (value) {
        console.log(`✓ ${header}: ${value}`);
      } else {
        console.log(`✗ ${header}: NOT SET`);
      }
    });
    
    console.log('\n=== Test Complete ===');
    server.close();
    process.exit(0);
  }).on('error', (err) => {
    console.error('Request error:', err);
    server.close();
    process.exit(1);
  });
});
