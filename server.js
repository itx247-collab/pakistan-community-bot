import express from "express";
import crypto from "crypto";

const app = express();
const PORT = process.env.PORT || 3000;

const PUBLIC_KEY =
  "6c96e368eee0944b026356a7a2ede8fefb20e6f16f2b0ebf402e4b131060ce94";

const jokes = [
  "Teacher: Why are you late? Student: Because of the sign. Teacher: What sign? Student: School Ahead, Go Slow! 😂",
  "Why did the computer go to the doctor? Because it had a virus! 🤣",
  "Friend: Are you sleeping? Me: No, I'm just buffering! 😂",
  "Pakistanis don't need Google Maps. Just ask a nearby uncle! 😁"
];

const truths = [
  "What is your funniest childhood memory?",
  "Who is your favourite person in this group?",
  "Have you ever told a lie to escape trouble?",
  "What is your biggest dream?",
  "What is the most embarrassing thing you've done?",
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
    question: "Which is the national animal of Pakistan?",
    answer: "Markhor 🐐"
  },
  {
    question: "When did Pakistan become independent?",
    answer: "14 August 1947 🇵🇰"
  },
  {
    question: "What is the national language of Pakistan?",
    answer: "Urdu"
  },
  {
    question: "Which is the highest mountain in Pakistan?",
    answer: "K2 🏔️"
  }
];

function randomItem(array) {
  return array[Math.floor(Math.random() * array.length)];
}

// Interactive game menu
function getComponents(content) {
  if (content.trim().toLowerCase() === "!play") {
    return {
      content: "🎮 PAKISTAN COMMUNITY GAME!\nChoose your challenge:",
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

  return null;
}

// Existing bot commands
function getReply(content) {
  const parts = content.trim().split(/\s+/);
  const command = parts[0].toLowerCase();

  switch (command) {
    case "!help":
      return `🇵🇰 WELCOME TO PAKISTAN COMMUNITY!

Here are my commands:

!hello - Say hello
!joke - Get a funny joke
!truth - Truth game
!dare - Dare game
!quiz - Pakistan quiz
!play - Interactive games
!meme - Funny meme text
!about - About our community
!help - Show commands

Let's have fun! 🎉`;

    case "!hello":
      return "Assalam-o-Alaikum! 👋 Welcome to Pakistan Community! 🇵🇰";

    case "!joke":
      return "😂 " + randomItem(jokes);

    case "!truth":
      return "🔥 TRUTH TIME!\n" + randomItem(truths);

    case "!dare":
      return "😈 DARE TIME!\n" + randomItem(dares);

    case "!quiz": {
      const quiz = randomItem(quizzes);
      return `🧠 PAKISTAN QUIZ 🇵🇰\n\n${quiz.question}\n\nThink carefully! The answer is: ${quiz.answer}`;
    }

    case "!meme":
      return randomItem([
        "When someone says 'I'm coming in 5 minutes' but arrives after 2 hours! 😂",
        "Me: I'll sleep early tonight. Also me at 3 AM: 🤣",
        "When Wi-Fi stops working in Pakistan: NATIONAL EMERGENCY! 😂",
        "Monday morning: Battery 1%, Motivation 0%! 😴"
      ]);

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
  express.raw({ type: "application/json", limit: "16kb" }),
  (req, res) => {
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

      if (!valid) return res.sendStatus(401);

      const event = JSON.parse(req.body.toString("utf8"));

      // Verification ping
      if (event.type === "ping") {
        return res.status(200).json({
          nonce: event.data.nonce
        });
      }

      // Command handling
      if (event.type === "command") {
        const content = event.data.content || "";

        const game = getComponents(content);

        if (game) {
          return res.status(200).json({
            reply: game
          });
        }

        const reply = getReply(content);

        if (reply) {
          return res.status(200).json({
            reply: {
              content: reply
            }
          });
        }
      }

      // Interactive button handling
      if (event.type === "component_click") {
        const button = event.data.component_id;

        let reply = "";

        if (button === "truth") {
          reply = "🔥 TRUTH TIME!\n" + randomItem(truths);
        } else if (button === "dare") {
          reply = "😈 DARE TIME!\n" + randomItem(dares);
        } else if (button === "quiz") {
          const quiz = randomItem(quizzes);

          reply =
            "🧠 PAKISTAN QUIZ 🇵🇰\n\n" +
            quiz.question +
            "\n\nAnswer: " +
            quiz.answer;
        }

        if (reply) {
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

  try {
    const response = await fetch(
      "https://bots.duckapps.com.br/bot/v1/webhook/verify",
      {
        method: "POST",
        headers: {
          Authorization: `Bot ${process.env.DUCKS_BOT_TOKEN}`
        }
      }
    );

    console.log("Verification status:", response.status);
    console.log(await response.text());

  } catch (error) {
    console.error("Verification error:", error.message);
  }
});
