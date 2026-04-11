const http = require('http');
const Anthropic = require('@anthropic-ai/sdk');

const PORT = process.env.PORT || 8080;

// --- Claude setup ---
const anthropic = new Anthropic.default({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SYSTEM_PROMPT = `Sos un asistente de proveeduría para una empresa constructora en Costa Rica. 
Tu trabajo es ayudar a registrar compras de materiales, consultar inventario, registrar facturas y generar reportes.

Reglas importantes:
- Hablás en español costarricense (vos, mae, tuanis, etc.) pero mantenés profesionalismo.
- Siempre confirmás los datos antes de registrar algo.
- Si no entendés algo, pedís aclaración en vez de asumir.
- Sos conciso — los mensajes son por WhatsApp, no escribas párrafos largos.
- Usás emojis con moderación para hacer el chat más amigable.

Por ahora estás en modo de prueba. Respondé a los mensajes del usuario de forma natural y útil.
Cuando el usuario te pida registrar una compra, consultar inventario o algo relacionado, 
decile que el sistema de registro se está configurando y que pronto estará disponible.`;

// Simple in-memory conversation history (per phone number)
const conversations = new Map();

function getConversation(phoneNumber) {
  if (!conversations.has(phoneNumber)) {
    conversations.set(phoneNumber, []);
  }
  return conversations.get(phoneNumber);
}

// Keep only last 20 messages per user to manage token usage
function trimConversation(messages) {
  if (messages.length > 20) {
    return messages.slice(-20);
  }
  return messages;
}

// --- Claude API call ---
async function askClaude(phoneNumber, userMessage) {
  const messages = getConversation(phoneNumber);
  messages.push({ role: 'user', content: userMessage });

  const trimmed = trimConversation(messages);
  conversations.set(phoneNumber, trimmed);

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages: trimmed,
    });

    const assistantMessage = response.content[0].text;

    // Save assistant response to conversation history
    trimmed.push({ role: 'assistant', content: assistantMessage });

    return assistantMessage;
  } catch (err) {
    console.error('Claude API error:', err);
    return 'Mae, tuve un problema procesando tu mensaje. Intentá de nuevo en un momento. 🔧';
  }
}

// --- WhatsApp messaging ---
async function sendWhatsAppMessage(to, text) {
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID;
  const accessToken = process.env.META_ACCESS_TOKEN;

  // WhatsApp has a 4096 character limit per message
  const chunks = [];
  if (text.length <= 4096) {
    chunks.push(text);
  } else {
    for (let i = 0; i < text.length; i += 4096) {
      chunks.push(text.slice(i, i + 4096));
    }
  }

  for (const chunk of chunks) {
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
            text: { body: chunk },
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
}

// --- HTTP Server ---
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
        const entry = data.entry?.[0];
        const changes = entry?.changes?.[0];
        const value = changes?.value;
        const message = value?.messages?.[0];

        if (message) {
          const from = message.from;
          const type = message.type;

          // Only handle text messages for now
          if (type === 'text') {
            const text = message.text?.body || '';
            console.log(`Message from ${from}: ${text}`);

            // Process with Claude (async, don't block webhook response)
            askClaude(from, text)
              .then((reply) => {
                console.log(`Reply to ${from}: ${reply}`);
                return sendWhatsAppMessage(from, reply);
              })
              .catch((err) => {
                console.error('Error in message pipeline:', err);
              });
          } else {
            console.log(`Non-text message from ${from} [${type}] — skipping for now`);
            sendWhatsAppMessage(from, 'Por ahora solo puedo leer mensajes de texto. Pronto voy a poder ver fotos de facturas también 📸');
          }
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

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});