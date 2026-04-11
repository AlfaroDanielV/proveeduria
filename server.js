const http = require('http');

const PORT = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // Health check
  if (url.pathname === '/' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('Proveeduria webhook running');
  }

  // GET /webhook — Meta verification
  if (url.pathname === '/webhook' && req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
      console.log('Webhook verified successfully');
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end(challenge);
    }

    console.warn('Webhook verification failed — token mismatch');
    res.writeHead(403);
    return res.end('Forbidden');
  }

  // POST /webhook — incoming WhatsApp messages
  if (url.pathname === '/webhook' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      // Respond 200 immediately — Meta requires response within 15s
      res.writeHead(200);
      res.end('OK');

      try {
        const data = JSON.parse(body);

        // Extract message if present
        const entry = data.entry?.[0];
        const changes = entry?.changes?.[0];
        const value = changes?.value;
        const message = value?.messages?.[0];

        if (message) {
          const from = message.from;
          const type = message.type;
          const text = message.text?.body || '';
          console.log(`Message from ${from} [${type}]: ${text}`);

          // TODO: Route to Claude agent logic
          // For now, echo back to confirm the pipeline works
          sendWhatsAppMessage(from, `Recibido: "${text}"`);
        }
      } catch (err) {
        console.error('Error processing webhook:', err);
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

// Send a WhatsApp message via Meta Cloud API
async function sendWhatsAppMessage(to, text) {
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID;
  const accessToken = process.env.META_ACCESS_TOKEN;

  try {
    const response = await fetch(
      `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: text },
        }),
      }
    );

    const result = await response.json();
    if (!response.ok) {
      console.error('Meta API error:', JSON.stringify(result));
    }
  } catch (err) {
    console.error('Failed to send message:', err);
  }
}

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
