import WebTorrent from "webtorrent";
import path from "path";
import parseTorrent from "parse-torrent";
import axios from "axios";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const client = new WebTorrent();
client.setMaxListeners(100);

let currentTorrent = null;

function isMediaFile(file) {
  return file.endsWith(".mkv") || file.endsWith(".mp4");
}
export function torrentIdFromQuery(query) {
  const { dn, tr, xt } = query;
  return `magnet:?xt=${xt}&dn=${dn}${tr.map((t) => `tr=${t}`).join("&")}`;
}

export function mediaType(file) {
  if (file.endsWith(".mkv")) {
    return "video/x-matroska";
  }
  if (file.endsWith(".mp4")) {
    return "video/mp4";
  }
}

const CHUNK_SIZE = 10 ** 6; // 1MB

const streamTorrent = (torrent, req, res) => {
  const file = torrent?.files?.find((file) => isMediaFile(file?.name));
  if (!file) {
    return res.status(400).json({ error: "No media file found" });
  }

  const fileSize = file.length;
  const range = req.headers.range;
  const contentType = mediaType(file.name);

  if (range) {
    const rangeMatch = range.match(/bytes=(\d+)-(\d*)/);
    if (!rangeMatch) {
      return res.status(416).json({ error: "Invalid range format" });
    }

    const start = parseInt(rangeMatch[1], 10);
    const end = rangeMatch[2]
      ? parseInt(rangeMatch[2], 10)
      : Math.min(start + CHUNK_SIZE, fileSize - 1);

    if (start >= fileSize || end >= fileSize) {
      res.writeHead(416, {
        "Content-Range": `bytes */${fileSize}`,
      });
      return res.end();
    }

    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
      "Content-Length": end - start + 1,
      "Content-Type": contentType,
    });

    const readStream = file.createReadStream({ start, end });
    readStream.on("error", (err) => {
      console.error("Stream error:", err);
      res.destroy(err);
    });

    readStream.pipe(res);
  } else {
    res.writeHead(200, {
      "Content-Length": fileSize,
      "Content-Type": contentType,
    });

    const readStream = file.createReadStream();
    readStream.on("error", (err) => {
      console.error("Stream error:", err);
      res.destroy(err);
    });

    readStream.pipe(res);
  }
};
const torrentIds =
  "magnet:?xt=urn:btih:381e590c57b9da5aa00e0da89bccdd6cade1d742&dn=Deadpool+Wolverine+(2024)+%5BREPACK%5D+%5B720p%5D+%5BBluRay%5D+%5BYTS.MX%5D&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce&tr=udp%3A%2F%2Fp4p.arenabg.com%3A1337%2Fannounce&tr=udp%3A%2F%2Ftracker.torrent.eu.org%3A451%2Fannounce&tr=udp%3A%2F%2Ftracker.dler.org%3A6969%2Fannounce&tr=udp%3A%2F%2Fopen.stealth.si%3A80%2Fannounce&tr=udp%3A%2F%2Fipv4.tracker.harry.lu%3A80%2Fannounce&tr=https%3A%2F%2Fopentracker.i2p.rocks%3A443%2Fannounce";
export async function handler(req, res) {
  const torrentId = await sanitizeMagnetLink(req.query.torrentId);

  if (!torrentId) {
    return res.status(400).json({ error: "Incorrect magnet URI" });
  }

  const torrentAlreadyAdded = await client.get(torrentId);
  if (torrentAlreadyAdded) {
    return streamTorrent(torrentAlreadyAdded, req, res);
  }

  const torrent = await new Promise((resolve) => {
    client.add(
      torrentId,
      {
        path: path.resolve(process.cwd(), "torrents"),
        destroyStoreOnDestroy: true,
        strategy: "sequential",
      },
      (torrent) => {
        resolve(torrent);
      }
    );
  });

  currentTorrent = torrent;

  if (!torrent) {
    return res.status(400).json({ error: "Error adding torrent" });
  }

  let torrentIsReady = false;
  let count = 0;
  while (!torrentIsReady) {
    if (count > 60) {
      break;
    }
    if (
      torrent.files.length > 0 &&
      torrent.ready &&
      torrent.files.find((file) => isMediaFile(file.name))
    ) {
      torrentIsReady = true;
    }
    await new Promise((r) => setTimeout(r, 1000));
    count++;
  }

  if (!torrentIsReady) {
    return res.status(400).json({ error: "Torrent not ready for streaming" });
  }

  streamTorrent(torrent, req, res);
}

async function sanitizeMagnetLink(torrentUrl) {
  try {
    // Step 1: Download .torrent file
    const response = await axios.get(torrentUrl, {
      responseType: "arraybuffer",
    });

    // Step 2: Parse the .torrent file
    const torrent = parseTorrent(response.data);

    // Step 3: Build the magnet URI manually with custom trackers if needed
    const trackers = [
      "udp://tracker.opentrackr.org:1337/announce",
      "udp://p4p.arenabg.com:1337/announce",
      "udp://tracker.torrent.eu.org:451/announce",
      "udp://tracker.dler.org:6969/announce",
      "udp://open.stealth.si:80/announce",
      "udp://ipv4.tracker.harry.lu:80/announce",
      "https://opentracker.i2p.rocks:443/announce",
    ];

    const encodedName = encodeURIComponent(torrent.name).replace(/%20/g, "+");

    const magnet =
      `magnet:?xt=urn:btih:${torrent.infoHash}&dn=${encodedName}` +
      trackers.map((tr) => `&tr=${encodeURIComponent(tr)}`).join("");

    return magnet;
  } catch (err) {
    console.error("Error converting torrent to magnet:", err.message);
    return null;
  }
}

export async function destroyTorrent(req, res) {
  if (currentTorrent) {
    currentTorrent.destroy(() => {
      currentTorrent = null;
      console.log("Torrent destroyed");

      // Step 2: Clean up folder
      const folderPath = path.join(__dirname, "torrents");

      fs.rm(folderPath, { recursive: true, force: true }, (err) => {
        if (err) {
          console.error("Failed to remove torrents folder:", err);
          return res.status(500).send("Failed to remove torrents folder");
        }

        console.log("Torrents folder deleted");
        res.send("Stream destroyed and torrents folder deleted");
      });
    });
  } else {
    res.status(404).send("No active torrent to destroy");
  }
}
