import express from "express";
import crypto from "crypto";

const app = express();
const PORT = process.env.PORT || 3000;

const PUBLIC_KEY =
  "6c96e368eee0944b026356a7a2ede8fefb20e6f16f2b0ebf402e4b131060ce94";

const API = "https://bots.duckapps.com.br/bot/v1";
const TOKEN = process.env.DUCKS_BOT_TOKEN;

const jokes = [
  "Teacher: Why are you late? Student: School Ahead, Go Slow! 😂",
  "Why did the computer go to the doctor? It had a virus! 🤣",
  "I'm not lazy. I'm on energy-saving mode! 😂",
  "Pakistanis don't need Google Maps. Just ask an uncle! 😁"
];

const truths = [
  "What is your funniest childhood memory?",
  "Who is your favourite person in this group?",
  "Have you ever told a lie to escape trouble?",
  "What is your biggest dream?",
  "What is your most embarrassing moment?",
  "If you could travel anywhere, where would you go?"
];

const dares = [
  "Send your funniest selfie! 😂",
  "Write a funny sentence without using the letter A.",
  "Compliment three members of this group.",
  "Send your favourite emoji 10 times!",
  "Sing two lines of your favourite song.",
  "Tell everyone your funniest nickname!"
];

const quizzes = [
  {
    question: "What is the capital of Pakistan?",
    answer: "Islamabad 🇵🇰"
  },
  {
    question: "What is Pakistan's national animal?",
    answer: "Markhor 🐐"
  },
  {
    question: "When did Pakistan become independent?",
    answer: "14 August 1947 🇵🇰"
  },
  {
    question: "What is Pakistan's national language?",
    answer: "Urdu"
  },
  {
    question: "Which is Pakistan's highest mountain?",
    answer: "K2 🏔️"
  }
];

const memes = [
  "When Wi-Fi stops working in Pakistan: NATIONAL EMERGENCY! 😂",
  "Me: I'll sleep early tonight. Also me at 3 AM: 🤣",
  "When someone says 5 minutes but arrives after 2 hours! 😂",
  "Monday morning: Battery 1%, Motivation 0%! 😴"
];

// Temporary scores. These reset if Render restarts.
const scores = {};

function randomItem(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function getGameMenu() {
  return {
    content: "🇵🇰 PAKISTAN COMMUNITY GAME!\n\nChoose your challenge:",
    components: [
      {
        id: "truth",
        label: "🔥 Truth",
        style: "primary"
      },
      {
        id: "dare",
        label: "😈 Dare",
        style: "danger"
      },
      {
        id: "quiz",
        label: "🧠 Quiz",
        style: "secondary"
      }
    ]
  };
}

function getDailyQuiz() {
  const date = new Date().toISOString().slice(0, 10);
  let total = 0;

  for (const char of date) {
    total += char.charCodeAt(0);
  }

  return quizzes[total % quizzes.length];
}

function getReply(content, user) {
  const parts = content.trim().split(/\s+/);
  const command = (parts[0] || "").toLowerCase();
  const argument = parts.slice(1).join(" ");

  switch (command) {
    case "!help":
      return `🇵🇰 PAKISTAN COMMUNITY BOT

!hello - Welcome message
!joke - Random joke
!truth - Truth challenge
!dare - Dare challenge
!game - Interactive games
!quiz - Pakistan quiz
!dailyquiz - Daily quiz
!meme - Funny meme
!ask - AI question (setup required)
!points - Your points
!leaderboard - Top players
!play - Music request
!about - Community information

Enjoy your time! 🎉`;

    case "!hello":
      return "Assalam-o-Alaikum! 👋 Welcome to Pakistan Community! 🇵🇰";

    case "!joke":
      return "😂 " + randomItem(jokes);

    case "!truth":
      return "🔥 TRUTH TIME!\n" + randomItem(truths);

    case "!dare":
      return "😈 DARE TIME!\n" + randomItem(dares);

    case "!game":
      return null;

    case "!quiz": {
      const quiz = randomItem(quizzes);
      return `🧠 PAKISTAN QUIZ 🇵🇰\n\n${quiz.question}\n\nAnswer: ${quiz.answer}`;
    }

    case "!dailyquiz": {
      const quiz = getDailyQuiz();
      return `📅 DAILY QUIZ 🇵🇰\n\n${quiz.question}\n\nAnswer: ${quiz.answer}`;
    }

    case "!meme":
      return "😂 " + randomItem(memes);

    case "!ask":
      return argument
        ? "🤖 AI service is not connected yet. This feature needs an AI API key."
        : "Please write your question after !ask.";

    case "!play":
      return argument
        ? `🎵 Music request: ${argument}\n\nAudio and voice-note sending are not supported by the Ducks API documentation available to us.`
        : "🎵 Use !play followed by a song name.\nExample: !play Believer";

    case "!points": {
      const id = user?.id;

      if (!id) return "I couldn't identify your account.";

      return `🏆 Your points: ${scores[id]?.points || 0}`;
    }

    case "!leaderboard": {
      const ranking = Object.entries(scores)
        .sort((a, b) => b[1].points - a[1].points)
        .slice(0, 10);

      if (!ranking.length) {
        return "🏆 No scores yet. Play a game to earn points!";
      }

      return "🏆 PAKISTAN COMMUNITY LEADERBOARD\n\n" +
        ranking.map((entry, index) =>
          `${index + 1}. ${entry[1].name} — ${entry[1].points} points`
        ).join("\n");
    }

    case "!about":
      return "🇵🇰 PAKISTAN COMMUNITY 🇵🇰\n\nA place for friendship, entertainment, games, laughter and Pakistani culture!\n\nStay connected. Stay united. ❤️";

    default:
      return null;
  }
}

app.get("/", (req, res) => {
  res.send("Pakistan Community Bot is running! 🇵🇰");
});

app.post(
  "/webhook",
  express.raw({
    type: "application/json",
    limit: "16kb"
  }),
  async (req, res) => {
    try {
      const signature = req.headers["x-ducks-signature"];
      const timestamp = req.headers["x-ducks-timestamp"];

      if (!signature || !timestamp || !req.body) {
        return res.sendStatus(401);
      }

      const time = Number(timestamp);

      if (
        !Number.isFinite(time) ||
        Math.abs(Date.now() / 1000 - time) > 300
      ) {
        return res.sendStatus(401);
      }

      const publicKey = crypto.createPublicKey({
        key: Buffer.concat([
          Buffer.from("302a300506032b6570032100", "hex"),
          Buffer.from(PUBLIC_KEY, "hex")
        ]),
        format: "der",
        type: "spki"
      });

      const signedData = Buffer.concat([
        Buffer.from(timestamp + "."),
        req.body
      ]);

      const valid = crypto.verify(
        null,
        signedData,
        publicKey,
        Buffer.from(signature, "hex")
      );

      if (!valid) {
        return res.sendStatus(401);
      }

      const event = JSON.parse(req.body.toString("utf8"));

      // Webhook verification
      if (event.type === "ping") {
        return res.status(200).json({
          nonce: event.data.nonce
        });
      }

      // Commands
      if (event.type === "command") {
        const content = event.data.content || "";
        const user = event.data.author;

        if (content.trim().toLowerCase() === "!game") {
          return res.status(200).json({
            reply: getGameMenu()
          });
        }

        const reply = getReply(content, user);

        if (reply) {
          return res.status(200).json({
            reply: {
              content: reply
            }
          });
        }
      }

      // Interactive game buttons
      if (event.type === "component_click") {
        const data = event.data || {};
        const button = data.component_id;
        const messageId = data.message_id;
        const user = data.user || {};
        const userId = user.id;

        let reply = "";

        if (button === "truth") {
          reply = "🔥 TRUTH TIME!\n" + randomItem(truths);
        } else if (button === "dare") {
          reply = "😈 DARE TIME!\n" + randomItem(dares);
        } else if (button === "quiz") {
          const quiz = randomItem(quizzes);

          reply =
            `🧠 PAKISTAN QUIZ 🇵🇰\n\n${quiz.question}\n\nAnswer: ${quiz.answer}`;
        }

        if (reply) {
          if (userId) {
            if (!scores[userId]) {
              scores[userId] = {
                name: user.nickname || "Player",
                points: 0
              };
            }

            scores[userId].name =
              user.nickname || scores[userId].name;

            scores[userId].points += 1;
          }

          // Update original game message and remove buttons.
          if (messageId && TOKEN) {
            try {
              const update = await fetch(
                `${API}/messages/${messageId}`,
                {
                  method: "PATCH",
                  headers: {
                    Authorization: `Bot ${TOKEN}`,
                    "Content-Type": "application/json"
                  },
                  body: JSON.stringify({
                    content: "🇵🇰 PAKISTAN COMMUNITY GAME\n\n✅ Challenge completed! Thanks for playing! 🎉",
                    components: []
                  })
                }
              );

              const result = await update.text();

              if (!update.ok) {
                console.error(
                  "Button update failed:",
                  update.status,
                  result
                );
              } else {
                console.log("Game buttons removed successfully!");
              }

            } catch (error) {
              console.error(
                "Button update error:",
                error.message
              );
            }
          }

          return res.status(200).json({
            reply: {
              content: reply
            }
          });
        }
      }

      return res.sendStatus(200);

    } catch (error) {
      console.error("Webhook error:", error.message);
      return res.sendStatus(400);
    }
  }
);

app.listen(PORT, async () => {
  console.log(`Pakistan Community Bot running on port ${PORT}`);

  if (!TOKEN) {
    console.error("DUCKS_BOT_TOKEN is missing!");
    return;
  }

  try {
    const response = await fetch(
      `${API}/webhook/verify`,
      {
        method: "POST",
        headers: {
          Authorization: `Bot ${TOKEN}`
        }
      }
    );

    console.log("Verification status:", response.status);
    console.log(await response.text());

  } catch (error) {
    console.error("Verification error:", error.message);
  }
});
