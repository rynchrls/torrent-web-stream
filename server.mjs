import express from "express";
import cors from "cors";
import parseTorrent from "parse-torrent";
import { handler, destroyTorrent } from "./webTorrent.mjs";
const app = express();

app.use(cors());
app.use(express.json());

app.get("/torrent", handler);
app.post("/destroy", destroyTorrent);

app.listen(3001, () => console.log("Proxy running on http://localhost:3001"));
