import express from "express";
import crypto from "node:crypto";

const app = express();
const PORT = Number(process.env.PORT || 3000);

const API = "https://bots.duckapps.com.br/bot/v1";

const TOKEN = process.env.DUCKS_BOT_TOKEN;

const SIGNING_HEX =
  process.env.DUCKS_SIGNING_PUBLIC_KEY ||
  "6c96e368eee0944b026356a7a2ede8fefb20e6f16f2b0ebf402e4b131060ce94";

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

const MENTION = "@pakistancommuni_f666";

const SPKI = Buffer.from(
  "302a300506032b6570032100",
  "hex"
);

const publicKey = crypto.createPublicKey({
  key: Buffer.concat([
    SPKI,
    Buffer.from(SIGNING_HEX, "hex")
  ]),
  format: "der",
  type: "spki"
});

const seen = new Map();
const memory = new Map();

const MAX_BODY = 16 * 1024;
const EVENT_TTL = 5 * 60 * 1000;
const MEMORY_TTL = 30 * 60 * 1000;
const MAX_TURNS = 8;

// Clean expired event IDs and conversations.

function prune(map, ttl) {
  const now = Date.now();

  for (const [key, value] of map) {
    if (now - value.time > ttl) {
      map.delete(key);
    }
  }
}

setInterval(() => {
  prune(seen, EVENT_TTL);
  prune(memory, MEMORY_TTL);
}, 60000).unref();


// Verify Ducks webhook signature.

function validSignature(headers, raw) {
  const timestamp = headers["x-ducks-timestamp"];
  const signature = headers["x-ducks-signature"];

  if (
    typeof timestamp !== "string" ||
    !/^\d{1,12}$/.test(timestamp)
  ) {
    return false;
  }

  if (
    typeof signature !== "string" ||
    !/^[a-f0-9]{128}$/i.test(signature)
  ) {
    return false;
  }

  if (
    Math.abs(Date.now() / 1000 - Number(timestamp)) > 300
  ) {
    return false;
  }

  const signed = Buffer.concat([
    Buffer.from(timestamp + "."),
    raw
  ]);

  try {
    return crypto.verify(
      null,
      signed,
      publicKey,
      Buffer.from(signature, "hex")
    );
  } catch {
    return false;
  }
}


// Small delay helper.

const wait = ms =>
  new Promise(resolve => setTimeout(resolve, ms));


// Ducks API request.

async function ducks(path, options = {}) {
  if (!TOKEN) {
    throw new Error("DUCKS_BOT_TOKEN is missing");
  }

  const headers = {
    Authorization: `Bot ${TOKEN}`
  };

  let body;

  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  const response = await fetch(API + path, {
    method: options.method || "GET",
    headers,
    body,
    signal: AbortSignal.timeout(20000)
  });

  const text = await response.text();

  let data;

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }

  if (!response.ok) {
    const error = new Error(
      data.message || `Ducks API returned ${response.status}`
    );

    error.status = response.status;
    error.retryAfter = Number(data.retry_after || 0);

    throw error;
  }

  return data;
}


// Send a message with retry support.

async function sendMessage(threadId, content, replyTo) {
  const nonce = crypto.randomUUID();

  let delay = 1000;

  for (let attempt = 0; ; attempt++) {
    try {
      return await ducks(
        `/rooms/${encodeURIComponent(threadId)}/messages`,
        {
          method: "POST",
          body: {
            content,
            ...(replyTo ? { reply_to: replyTo } : {}),
            nonce
          }
        }
      );
    } catch (error) {
      if (
        ![429, 503].includes(error.status) ||
        attempt >= 5
      ) {
        throw error;
      }

      const ms = Math.max(
        error.retryAfter * 1000,
        delay
      );

      console.warn(
        `Ducks API ${error.status}; retrying in ${ms}ms`
      );

      await wait(ms);

      delay = Math.min(delay * 2, 30000);
    }
  }
}


// OpenAI AI response.

async function getAIAnswer(history, prompt) {
  if (!OPENAI_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const input = [
    {
      role: "system",
      content:
        "You are Pakistan Community Bot, a friendly and helpful community assistant. Be concise and natural. Understand English, Urdu, and Roman Urdu."
    },

    ...history,

    {
      role: "user",
      content: prompt
    }
  ];

  const response = await fetch(
    "https://api.openai.com/v1/responses",
    {
      method: "POST",

      headers: {
        Authorization: `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json"
      },

      body: JSON.stringify({
        model: OPENAI_MODEL,
        input
      }),

      signal: AbortSignal.timeout(90000)
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data.error?.message ||
      `OpenAI returned ${response.status}`
    );
  }

  const answer = (data.output || [])
    .flatMap(x => x.content || [])
    .filter(x => x.type === "output_text")
    .map(x => x.text)
    .join("\n")
    .trim();

  if (!answer) {
    throw new Error("AI returned an empty response");
  }

  return answer.slice(0, 4000);
}


// Recognize bot commands and mentions.

function parseMessage(text) {
  const value = String(text || "").trim();

  if (/^!bot$/i.test(value)) {
    return { kind: "alive" };
  }

  const ask = value.match(/^!ask(?:\s+([\s\S]+))?$/i);

  if (ask) {
    return {
      kind: "ai",
      prompt: (ask[1] || "").trim()
    };
  }

  const index = value
    .toLowerCase()
    .indexOf(MENTION.toLowerCase());

  if (index >= 0) {
    return {
      kind: "ai",

      prompt: (
        value.slice(0, index) +
        value.slice(index + MENTION.length)
      ).trim()
    };
  }

  return { kind: "ignore" };
}


// Process AI messages in the background.

async function handleAI(event, prompt) {
  const d = event.data || {};

  if (!d.thread_id || !d.author?.id) {
    return;
  }

  if (!prompt) {
    await sendMessage(
      d.thread_id,
      "Please write your question after !ask or my mention.",
      d.message_id
    );

    return;
  }

  const key =
    `${d.community_id || "community"}:${d.thread_id}:${d.author.id}`;

  const old = memory.get(key);

  const history =
    old && Date.now() - old.time < MEMORY_TTL
      ? old.turns
      : [];

  try {
    const answer = await getAIAnswer(history, prompt);

    const turns = [
      ...history,

      {
        role: "user",
        content: prompt
      },

      {
        role: "assistant",
        content: answer
      }
    ].slice(-MAX_TURNS * 2);

    memory.set(key, {
      time: Date.now(),
      turns
    });

    await sendMessage(
      d.thread_id,
      answer,
      d.message_id
    );

    console.log("AI reply sent.");

  } catch (error) {
    console.error("AI reply failed:", error.message);

    try {
      await sendMessage(
        d.thread_id,
        "Sorry, I couldn't answer just now. Please try again shortly.",
        d.message_id
      );
    } catch (sendError) {
      console.error(
        "Could not send error reply:",
        sendError.message
      );
    }
  }
}


// Main pages.

app.get("/", (_req, res) => {
  res.send("Pakistan Community Bot 3.0 is running.");
});


app.get("/health", (_req, res) => {
  res.json({
    status: "online",
    ducksConfigured: Boolean(TOKEN),
    openaiConfigured: Boolean(OPENAI_KEY),
    model: OPENAI_MODEL
  });
});


// Ducks webhook.
// Keep raw body for signature verification.

app.post(
  "/webhook",
  express.raw({
    type: "*/*",
    limit: MAX_BODY
  }),

  (req, res) => {
    const raw = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.alloc(0);

    if (!validSignature(req.headers, raw)) {
      console.warn(
        "Webhook rejected: signature/timestamp invalid."
      );

      return res.status(401).end();
    }

    let event;

    try {
      event = JSON.parse(raw.toString("utf8"));
    } catch {
      return res.status(400).end();
    }

    const eventId =
      req.headers["x-ducks-event-id"] || event.id;

    if (!eventId) {
      return res.status(400).end();
    }

    // Always echo the ping nonce.

    if (event.type === "ping") {
      return res.status(200).json({
        nonce: event.data?.nonce
      });
    }

    // Ignore duplicate events.

    if (seen.has(eventId)) {
      return res.status(200).json({});
    }

    seen.set(eventId, {
      time: Date.now()
    });

    console.log(`Received event: ${event.type}`);


    // Commands.

    if (event.type === "command") {
      const parsed = parseMessage(
        event.data?.content
      );

      // Bot alive command.

      if (parsed.kind === "alive") {
        return res.status(200).json({
          reply: {
            content: "🇵🇰 Bot is Alive! ✅"
          }
        });
      }

      // AI commands.

      if (parsed.kind === "ai") {
        res.status(200).json({});

        setImmediate(() => {
          handleAI(event, parsed.prompt);
        });

        return;
      }
    }


    // Button clicks.

    if (event.type === "component_click") {
      return res.status(200).json({
        reply: {
          content:
            `Button received: ${String(
              event.data?.component_id || "button"
            ).slice(0, 80)}. 🇵🇰`
        }
      });
    }


    // Acknowledge other events.

    return res.status(200).json({});
  }
);


// Start server.

app.listen(PORT, () => {
  console.log(
    `🇵🇰 Pakistan Community Bot 3.0 listening on ${PORT}`
  );
});
