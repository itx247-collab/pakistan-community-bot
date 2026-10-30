import express from "express";
import crypto from "crypto";

const app = express();
const PORT = process.env.PORT || 3000;

const PUBLIC_KEY =
  "6c96e368eee0944b026356a7a2ede8fefb20e6f16f2b0ebf402e4b131060ce94";

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

      if (event.type === "ping") {
        return res.status(200).json({
          nonce: event.data.nonce
        });
      }

      return res.sendStatus(200);

    } catch (error) {
      console.error("Webhook error:", error.message);
      return res.sendStatus(400);
    }
  }
);

app.listen(PORT, () => {
  console.log(`Pakistan Community Bot running on port ${PORT}`);
});
