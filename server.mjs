import express from "express";
import cors from "cors";
import path from "path";
import { handler, destroyTorrent } from "./webTorrent.mjs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

app.use(cors());
app.use(express.json());

// Serve the HTML file
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/torrent", handler);
app.post("/destroy", destroyTorrent);

app.listen(3001, () => console.log("Proxy running on http://localhost:3001"));
