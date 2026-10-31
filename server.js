import express from "express";
import crypto from "crypto";

const app = express();
const PORT = process.env.PORT || 3000;

const DUCKS_API = "https://bots.duckapps.com.br/bot/v1";
const OPENAI_API = "https://api.openai.com/v1/responses";
const TAVILY_API = "https://api.tavily.com/search";

const BOT_TOKEN = process.env.DUCKS_BOT_TOKEN;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const TAVILY_KEY = process.env.TAVILY_API_KEY;
const MODEL = process.env.OPENAI_MODEL || "gpt-6-luna";

const PUBLIC_KEY_HEX =
  process.env.DUCKS_SIGNING_PUBLIC_KEY ||
  "6c96e368eee0944b026356a7a2ede8fefb20e6f16f2b0ebf402e4b131060ce94";

const PUBLIC_KEY = crypto.createPublicKey({
  key: Buffer.concat([
    Buffer.from("302a300506032b6570032100", "hex"),
    Buffer.from(PUBLIC_KEY_HEX, "hex")
  ]),
  format: "der",
  type: "spki"
});

app.use(express.raw({
  type: "application/json",
  limit: "16kb"
}));

const conversations = new Map();
const processedEvents = new Map();

const MAX_HISTORY = 8;
const MEMORY_TIME = 30 * 60 * 1000;

function verifySignature(headers, rawBody) {
  try {
    const signature = headers["x-ducks-signature"];
    const timestamp = headers["x-ducks-timestamp"];

    if (!signature || !timestamp) return false;

    const time = Number(timestamp);
    const now = Math.floor(Date.now() / 1000);

    if (!Number.isFinite(time) || Math.abs(now - time) > 300) {
      return false;
    }

    const signed = Buffer.concat([
      Buffer.from(timestamp + "."),
      rawBody
    ]);

    return crypto.verify(
      null,
      signed,
      PUBLIC_KEY,
      Buffer.from(signature, "hex")
    );
  } catch {
    return false;
  }
}

async function ducksRequest(path, options = {}) {
  if (!BOT_TOKEN) {
    throw new Error("Missing DUCKS_BOT_TOKEN");
  }

  const response = await fetch(`${DUCKS_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bot ${BOT_TOKEN}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Ducks API ${response.status}: ${text}`);
  }

  return text ? JSON.parse(text) : {};
}

async function sendMessage(threadId, content, replyTo = null) {
  const body = {
    content,
    nonce: crypto.randomUUID()
  };

  if (replyTo) body.reply_to = replyTo;

  for (let attempt = 0; attempt < 3; attempt++) {
    let response;

    try {
      response = await fetch(
        `${DUCKS_API}/rooms/${threadId}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bot ${BOT_TOKEN}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(body)
        }
      );
    } catch (error) {
      if (attempt === 2) throw error;

      await new Promise(resolve =>
        setTimeout(resolve, 1500)
      );

      continue;
    }

if (response.ok) return;

const errorText = await response.text();

if (response.status === 403) {
  console.log("DUCKS REJECTED MESSAGE:", JSON.stringify({
    status: response.status,
    content: String(message.content || "").slice(0, 1000),
    error: errorText
  }));
}

if (
  response.status !== 429 &&
  response.status !== 503
) {
  throw new Error(
    `Message error ${response.status}: ${errorText}`
  );
}

    let delay = 1500;

    try {
      const parsed = JSON.parse(errorText);

      if (parsed.retry_after) {
        delay = Math.max(1000, parsed.retry_after * 1000);
      }
    } catch {}

    await new Promise(resolve =>
      setTimeout(resolve, delay)
    );
  }
}

function getCommand(content) {
  const text = String(content || "").trim();
  const lower = text.toLowerCase();

  if (lower === "!bot") {
    return { type: "alive" };
  }

  if (lower.startsWith("!ask ")) {
    return {
      type: "ask",
      question: text.slice(5).trim()
    };
  }

  const mention = "@pakistancommuni_f666";
  const index = lower.indexOf(mention);

  if (index !== -1) {
    return {
      type: "ask",
      question: (
        text.slice(0, index) +
        text.slice(index + mention.length)
      ).trim()
    };
  }

  return null;
}

function needsWebSearch(question, history) {
  const q = question.toLowerCase();

  const searchWords = [
    "latest", "today", "current", "recent",
    "news", "price", "prices", "cost",
    "buy", "purchase", "where can i",
    "compare", "cheaper", "available",
    "specifications", "specs", "review",
    "website", "link", "source",
    "2026", "2025", "2027",
    "iphone", "samsung", "phone",
    "laptop", "car", "product",
    "research", "search", "youtube"
  ];

  const followUpWords = [
    "it", "that", "this", "them",
    "those", "which one", "cheaper",
    "where can i buy", "buy it"
  ];

  const hasFollowUp = followUpWords.some(word =>
    q.includes(word)
  );

  return (
    searchWords.some(word => q.includes(word)) ||
    (hasFollowUp && history.length > 0)
  );
}

async function webSearch(question, history) {
  if (!TAVILY_KEY) {
    console.log("Tavily key missing; skipping web search.");

    return null;
  }

  let context = "";

  if (history.length) {
    context = history
      .slice(-4)
      .map(item => `${item.role}: ${item.content}`)
      .join("\n");
  }

  const query = context
    ? `Conversation context:\n${context}\n\nLatest question: ${question}`
    : question;

  const response = await fetch(TAVILY_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      api_key: TAVILY_KEY,
      query,
      search_depth: "advanced",
      max_results: 6,
      include_answer: true,
      include_raw_content: false
    })
  });

  if (!response.ok) {
    const error = await response.text();

    throw new Error(
      `Tavily error ${response.status}: ${error}`
    );
  }

  const data = await response.json();

  return {
    answer: data.answer || "",
    results: (data.results || []).map(item => ({
      title: item.title,
      url: item.url,
      content: item.content,
      score: item.score
    }))
  };
}

async function askAI(history, question, searchData) {
  if (!OPENAI_KEY) {
    throw new Error("Missing OPENAI_API_KEY");
  }

  const systemPrompt = `
You are Pakistan Community AI 5.1.

You are a friendly, intelligent and helpful assistant
for Pakistan Community.

Personality:
- Friendly, respectful and natural.
- Understand English, Urdu and Roman Urdu.
- Give clear and useful answers.
- Behave like a helpful community assistant.
- Do not invent facts, prices, links or sources.

Research rules:
- Use supplied web research when available.
- Explain information in your own words.
- Include useful source links from the supplied results.
- Distinguish verified facts from uncertain information.
- Prices and availability can change; mention this.
- Never claim a product is PTA approved unless a source
  explicitly confirms it.
- For Pakistan shopping questions, prioritize Pakistani
  sellers and clearly identify the seller.
- Never invent a purchase link.
- If no reliable result is available, say so.
- Remember the conversation and understand follow-up
  questions such as "Where can I buy it?" and
  "Which one is cheaper?"
- Do not pretend to have searched the web if no
  search results were supplied.

Keep answers organized and easy to read.
`;

  const input = [
    {
      role: "system",
      content: systemPrompt
    },
    ...history.slice(-MAX_HISTORY),
    {
      role: "user",
      content: searchData
        ? `Question:\n${question}\n\nWeb research:\n${JSON.stringify(searchData)}`
        : question
    }
  ];

  const response = await fetch(OPENAI_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: MODEL,
      input
    })
  });

  if (!response.ok) {
    const error = await response.text();

    throw new Error(
      `OpenAI error ${response.status}: ${error}`
    );
  }

  const data = await response.json();

  if (data.output_text) {
    return data.output_text;
  }

  const text = (data.output || [])
    .flatMap(item => item.content || [])
    .filter(item => item.type === "output_text")
    .map(item => item.text)
    .join("\n");

  if (!text) {
    throw new Error("AI returned an empty response");
  }

  return text;
}

async function processAI(event, question) {
  const data = event.data;

  const memoryKey =
    `${data.community_id}:${data.thread_id}:${data.author.id}`;

  const existing = conversations.get(memoryKey);

  let history = [];

  if (
    existing &&
    Date.now() - existing.updated < MEMORY_TIME
  ) {
    history = existing.history;
  }

  try {
    let searchData = null;

    if (needsWebSearch(question, history)) {
      try {
        // Search silently. No announcement is sent to Ducks.
        console.log("Starting Tavily web search.");

        searchData = await webSearch(question, history);

        if (searchData) {
          console.log(
            `Tavily returned ${searchData.results.length} results.`
          );
        }
      } catch (error) {
        console.error("Web search failed:", error.message);

        // Continue the AI conversation if search fails.
        searchData = null;
      }
    }

    const answer = await askAI(
      history,
      question,
      searchData
    );

    history.push({
      role: "user",
      content: question
    });

    history.push({
      role: "assistant",
      content: answer
    });

    conversations.set(memoryKey, {
      history: history.slice(-MAX_HISTORY),
      updated: Date.now()
    });

    await sendMessage(
      data.thread_id,
      answer,
      data.message_id
    );

  } catch (error) {
    console.error("AI processing error:", error);

    try {
      await sendMessage(
        data.thread_id,
        "Sorry! I encountered a problem while processing your question. Please try again."
      );
    } catch (sendError) {
      console.error(
        "Could not send error response:",
        sendError.message
      );
    }
  }
}

app.get("/", (req, res) => {
  res.send("Pakistan Community AI 5.1 is running 🇵🇰");
});

app.get("/health", (req, res) => {
  res.json({
    status: "online",
    version: "5.1",
    ducksConfigured: Boolean(BOT_TOKEN),
    openaiConfigured: Boolean(OPENAI_KEY),
    tavilyConfigured: Boolean(TAVILY_KEY),
    model: MODEL
  });
});

app.post("/webhook", (req, res) => {
  const rawBody = req.body;

  if (!Buffer.isBuffer(rawBody)) {
    return res.status(400).send("Invalid body");
  }

  if (!verifySignature(req.headers, rawBody)) {
    return res.status(401).send("Invalid signature");
  }

  let event;

  try {
    event = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return res.status(400).send("Invalid JSON");
  }

  const eventId = req.headers["x-ducks-event-id"];

  if (event.type === "ping") {
    console.log("Ducks verification ping received");

    return res.status(200).json({
      nonce: event.data?.nonce
    });
  }

  if (eventId) {
    if (processedEvents.has(eventId)) {
      return res.status(200).json({});
    }

    processedEvents.set(eventId, Date.now());
  }

  res.status(200).json({});

  setImmediate(async () => {
    try {
      if (event.type === "command") {
        const command = getCommand(event.data?.content);

        if (!command) return;

        if (command.type === "alive") {
          await sendMessage(
            event.data.thread_id,
            "🇵🇰 Bot is Alive! ✅",
            event.data.message_id
          );

          return;
        }

        if (command.type === "ask" && command.question) {
          await processAI(event, command.question);
        }
      }

      if (event.type === "component_click") {
        await sendMessage(
          event.data.thread_id,
          "Thanks for interacting with Pakistan Community AI! 🇵🇰",
          event.data.message_id
        );
      }

      if (event.type === "installed") {
        console.log(
          "Bot installed in:",
          event.data.community_name
        );
      }

      if (event.type === "rooms_changed") {
        console.log(
          "Community rooms updated:",
          event.data.community_name
        );
      }

      if (event.type === "uninstalled") {
        console.log(
          "Bot uninstalled from:",
          event.data.community_name
        );
      }

    } catch (error) {
      console.error(
        "Webhook background error:",
        error.message
      );
    }
  });
});

setInterval(() => {
  const now = Date.now();

  for (const [key, value] of conversations) {
    if (now - value.updated > MEMORY_TIME) {
      conversations.delete(key);
    }
  }

  for (const [key, timestamp] of processedEvents) {
    if (now - timestamp > 10 * 60 * 1000) {
      processedEvents.delete(key);
    }
  }
}, 60 * 1000);

app.listen(PORT, () => {
  console.log(
    `Pakistan Community AI 5.1 running on ${PORT}`
  );

  if (BOT_TOKEN) {
    console.log("Starting Ducks webhook verification...");

    ducksRequest("/webhook/verify", {
      method: "POST"
    })
      .then(result => {
        console.log(
          "Webhook verification result:",
          result
        );
      })
      .catch(error => {
        console.error(
          "Webhook verification failed:",
          error.message
        );
      });
  }
});
