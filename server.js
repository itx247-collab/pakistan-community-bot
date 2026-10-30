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
      return `🧠
