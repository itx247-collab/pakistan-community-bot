import express from "express";
import crypto from "node:crypto";

const app = express();
const PORT = process.env.PORT || 3000;

// =====================================
// CONFIGURATION
// =====================================

const DUCKS_API =
  "https://bots.duckapps.com.br/bot/v1";

const DUCKS_TOKEN =
  process.env.DUCKS_BOT_TOKEN;

const OPENAI_KEY =
  process.env.OPENAI_API_KEY;

const OPENAI_MODEL =
  process.env.OPENAI_MODEL || "gpt-6-luna";

const PUBLIC_KEY =
  process.env.DUCKS_SIGNING_PUBLIC_KEY ||
  "6c96e368eee0944b026356a7a2ede8fefb20e6f16f2b0ebf402e4b131060ce94";

const BOT_MENTION =
  "@pakistancommuni_f666";

const MEMORY_DURATION =
  30 * 60 * 1000;

const MAX_MEMORY_TURNS = 8;

const MAX_BODY_SIZE = "16kb";

// =====================================
// SIGNATURE VERIFICATION
// =====================================

const publicKey = crypto.createPublicKey({
  key: Buffer.concat([
    Buffer.from(
      "302a300506032b6570032100",
      "hex"
    ),
    Buffer.from(PUBLIC_KEY, "hex")
  ]),
  format: "der",
  type: "spki"
});

function verifySignature(headers, rawBody) {

  const signature =
    headers["x-ducks-signature"];

  const timestamp =
    headers["x-ducks-timestamp"];

  if (!signature || !timestamp || !rawBody) {
    return false;
  }

  const time = Number(timestamp);

  if (
    !Number.isFinite(time) ||
    Math.abs(Date.now() / 1000 - time) > 300
  ) {
    return false;
  }

  if (!/^[a-f0-9]{128}$/i.test(signature)) {
    return false;
  }

  const signedData = Buffer.concat([
    Buffer.from(timestamp + "."),
    rawBody
  ]);

  try {
    return crypto.verify(
      null,
      signedData,
      publicKey,
      Buffer.from(signature, "hex")
    );
  } catch (error) {
    console.error(
      "Signature verification error:",
      error.message
    );

    return false;
  }
}

// =====================================
// TEMPORARY MEMORY
// =====================================

// Event IDs prevent duplicate processing.
// Conversation context exists only in RAM.

const processedEvents = new Map();
const conversations = new Map();

function cleanMemory() {

  const now = Date.now();

  for (const [key, value] of processedEvents) {
    if (now - value > 5 * 60 * 1000) {
      processedEvents.delete(key);
    }
  }

  for (const [key, value] of conversations) {
    if (now - value.time > MEMORY_DURATION) {
      conversations.delete(key);
    }
  }
}

setInterval(cleanMemory, 60000).unref();

// =====================================
// DUCKS API
// =====================================

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

async function ducksRequest(path, options = {}) {

  if (!DUCKS_TOKEN) {
    throw new Error(
      "DUCKS_BOT_TOKEN is missing"
    );
  }

  const headers = {
    Authorization: `Bot ${DUCKS_TOKEN}`
  };

  let body;

  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  const response = await fetch(
    DUCKS_API + path,
    {
      method: options.method || "GET",
      headers,
      body,
      signal: AbortSignal.timeout(20000)
    }
  );

  const text = await response.text();

  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }

  if (!response.ok) {

    const error = new Error(
      data.message ||
      `Ducks API error ${response.status}`
    );

    error.status = response.status;

    error.retryAfter =
      Number(data.retry_after || 0);

    throw error;
  }

  return data;
}

// =====================================
// SEND MESSAGE WITH RETRIES
// =====================================

async function sendMessage(
  threadId,
  content,
  replyTo
) {

  const nonce = crypto.randomUUID();

  let delay = 1000;

  for (let attempt = 0; ; attempt++) {

    try {

      return await ducksRequest(
        `/rooms/${encodeURIComponent(threadId)}/messages`,
        {
          method: "POST",

          body: {
            content,

            ...(replyTo
              ? { reply_to: replyTo }
              : {}),

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

      const waitTime = Math.max(
        error.retryAfter * 1000,
        delay
      );

      console.log(
        `Ducks retry in ${waitTime}ms`
      );

      await sleep(waitTime);

      delay = Math.min(
        delay * 2,
        30000
      );
    }
  }
}

// =====================================
// OPENAI AI
// =====================================

async function askAI(history, question) {

  if (!OPENAI_KEY) {
    throw new Error(
      "OPENAI_API_KEY is missing"
    );
  }

  const input = [

    {
      role: "system",

      content:
        "You are Pakistan Community Bot, a friendly and intelligent community assistant. You can speak English, Urdu and Roman Urdu. Be helpful, natural and conversational. Keep answers clear and appropriate for a community."
    },

    ...history,

    {
      role: "user",
      content: question
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
      `OpenAI error ${response.status}`
    );
  }

  const answer = (data.output || [])
    .flatMap(item => item.content || [])
    .filter(item => item.type === "output_text")
    .map(item => item.text)
    .join("\n")
    .trim();

  if (!answer) {
    throw new Error(
      "AI returned an empty answer"
    );
  }

  return answer.slice(0, 4000);
}

// =====================================
// COMMAND HANDLER
// =====================================

function getCommand(content) {

  const text = String(content || "").trim();

  if (/^!bot$/i.test(text)) {
    return {
      type: "alive"
    };
  }

  const ask = text.match(
    /^!ask(?:\s+([\s\S]+))?$/i
  );

  if (ask) {
    return {
      type: "ai",
      question: (ask[1] || "").trim()
    };
  }

  const mentionIndex = text
    .toLowerCase()
    .indexOf(BOT_MENTION.toLowerCase());

  if (mentionIndex !== -1) {

    const question = (
      text.slice(0, mentionIndex) +
      text.slice(mentionIndex + BOT_MENTION.length)
    ).trim();

    return {
      type: "ai",
      question
    };
  }

  return {
    type: "ignore"
  };
}

// =====================================
// AI MESSAGE PROCESSING
// =====================================

async function processAI(event, question) {

  const data = event.data || {};

  const threadId = data.thread_id;
  const messageId = data.message_id;
  const author = data.author;

  if (!threadId || !author?.id) {
    console.error(
      "AI event missing thread or author"
    );
    return;
  }

  if (!question) {

    await sendMessage(
      threadId,
      "Please write your question after !ask or mention me.",
      messageId
    );

    return;
  }

  const memoryKey =
    `${data.community_id || event.data.community_id || "community"}:${threadId}:${author.id}`;

  const oldMemory = conversations.get(memoryKey);

  const history =
    oldMemory &&
    Date.now() - oldMemory.time < MEMORY_DURATION
      ? oldMemory.turns
      : [];

  try {

    console.log("Sending question to AI...");

    const answer = await askAI(
      history,
      question
    );

    const updatedHistory = [
      ...history,

      {
        role: "user",
        content: question
      },

      {
        role: "assistant",
        content: answer
      }

    ].slice(-MAX_MEMORY_TURNS * 2);

    conversations.set(memoryKey, {
      time: Date.now(),
      turns: updatedHistory
    });

    await sendMessage(
      threadId,
      answer,
      messageId
    );

    console.log("AI answer successfully sent.");

  } catch (error) {

    console.error(
      "AI processing error:",
      error.message
    );

    try {

      await sendMessage(
        threadId,
        "Sorry! I'm having trouble answering right now. Please try again shortly.",
        messageId
      );

    } catch (sendError) {

      console.error(
        "Error sending failure message:",
        sendError.message
      );
    }
  }
}

// =====================================
// BASIC WEB ROUTES
// =====================================

app.get("/", (req, res) => {

  res.send(
    "🇵🇰 Pakistan Community Bot 4.0 is running!"
  );

});

app.get("/health", (req, res) => {

  res.json({

    status: "online",

    ducksConfigured: Boolean(DUCKS_TOKEN),

    openaiConfigured: Boolean(OPENAI_KEY),

    model: OPENAI_MODEL

  });

});

// =====================================
// DUCKS WEBHOOK
// =====================================

app.post(
  "/webhook",

  express.raw({
    type: "application/json",
    limit: MAX_BODY_SIZE
  }),

  async (req, res) => {

    try {

      const rawBody = req.body;

      if (!Buffer.isBuffer(rawBody)) {

        console.error(
          "Webhook body was not received as raw bytes"
        );

        return res.sendStatus(400);
      }

      // Verify signature before parsing JSON.

      const valid = verifySignature(
        req.headers,
        rawBody
      );

      if (!valid) {

        console.error(
          "Webhook rejected: invalid signature or timestamp"
        );

        return res.sendStatus(401);
      }

      const event = JSON.parse(
        rawBody.toString("utf8")
      );

      const eventId =
        req.headers["x-ducks-event-id"] ||
        event.id;

      console.log(
        "Verified Ducks event:",
        event.type
      );

      // Ping verification.

      if (event.type === "ping") {

        console.log(
          "Ducks verification ping received"
        );

        return res.status(200).json({

          nonce: event.data?.nonce

        });
      }

      // Ignore duplicate events.

      if (eventId && processedEvents.has(eventId)) {

        console.log(
          "Duplicate event ignored"
        );

        return res.sendStatus(200);
      }

      if (eventId) {
        processedEvents.set(
          eventId,
          Date.now()
        );
      }

      // =================================
      // COMMAND EVENTS
      // =================================

      if (event.type === "command") {

        const content =
          event.data?.content || "";

        console.log(
          "Command received"
        );

        const command = getCommand(content);

        // Bot alive.

        if (command.type === "alive") {

          return res.status(200).json({

            reply: {

              content: "🇵🇰 Bot is Alive! ✅"

            }

          });
        }

        // AI conversation.

        if (command.type === "ai") {

          // Respond to Ducks immediately.
          // AI processing happens afterward.

          res.status(200).json({});

          setImmediate(() => {

            processAI(
              event,
              command.question
            );

          });

          return;
        }
      }

      // =================================
      // COMPONENT CLICKS
      // =================================

      if (event.type === "component_click") {

        const componentId =
          event.data?.component_id || "button";

        return res.status(200).json({

          reply: {

            content:
              `You selected ${componentId}. 🇵🇰`

          }

        });
      }

      // =================================
      // OTHER EVENTS
      // =================================

      if (
        event.type === "installed" ||
        event.type === "rooms_changed" ||
        event.type === "uninstalled"
      ) {

        console.log(
          "Ducks installation event:",
          event.type
        );
      }

      return res.sendStatus(200);

    } catch (error) {

      console.error(
        "Webhook error:",
        error.message
      );

      if (!res.headersSent) {
        return res.sendStatus(400);
      }
    }

  }
);

// =====================================
// START SERVER AND VERIFY WEBHOOK
// =====================================

app.listen(PORT, async () => {

  console.log(
    `🇵🇰 Pakistan Community Bot 4.0 running on port ${PORT}`
  );

  console.log(
    "Starting Ducks webhook verification..."
  );

  try {

    const response = await fetch(
      `${DUCKS_API}/webhook/verify`,

      {

        method: "POST",

        headers: {

          Authorization:
            `Bot ${DUCKS_TOKEN}`

        },

        signal: AbortSignal.timeout(15000)

      }
    );

    console.log(
      "Webhook verification HTTP status:",
      response.status
    );

    const result = await response.text();

    console.log(
      "Webhook verification result:",
      result
    );

  } catch (error) {

    console.error(
      "Webhook verification failed:",
      error.message
    );

  }

});
