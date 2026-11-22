import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? "4021");
const app = createApp();
app.listen(port, () => {
  console.log(`[agentgate] seller listening on http://localhost:${port}`);
});
