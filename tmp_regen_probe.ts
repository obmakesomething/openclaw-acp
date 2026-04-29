import fs from "fs";

(async () => {
  const cfg = JSON.parse(
    fs.readFileSync("/Users/daeyounglee/virtuals-protocol-acp-buyer/config.json", "utf-8")
  );
  const token = cfg.SESSION_TOKEN.token as string;
  const wallets = [
    "0xcaD730948C0c4D9C37f60aD7ba899514B902e46e",
    "0x092Bd61Af8EDE22B8291bE9b88259BE8b9845657",
  ];

  for (const wallet of wallets) {
    const response = await fetch(
      `https://acpx.virtuals.io/api/agents/lite/${wallet}/regenerate-api`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );
    const body = await response.text();
    console.log(wallet, response.status, body);
  }
})();
