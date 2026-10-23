const { loadEnvFile } = require("node:process");
const { createServer } = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

try {
  loadEnvFile();
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const {
  Client,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
} = require("discord.js");

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;

if (!token) {
  throw new Error("Missing DISCORD_TOKEN. Set it in the environment or a local .env file.");
}

if (!clientId) {
  throw new Error("Missing DISCORD_CLIENT_ID. Set it in the environment or a local .env file.");
}

const commands = [
  new SlashCommandBuilder()
    .setName("hello")
    .setDescription("Replies with Hello World!"),
].map((command) => command.toJSON());

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const publicDirectory = path.join(__dirname, "public");
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
};

const webServer = createServer((request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end("Method not allowed");
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  } catch {
    response.writeHead(400);
    response.end("Bad request");
    return;
  }

  if (pathname.endsWith("/")) pathname += "index.html";
  const filePath = path.resolve(publicDirectory, "." + pathname);
  const relativePath = path.relative(publicDirectory, filePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500, {
        "Content-Type": "text/plain; charset=utf-8",
      });
      response.end(error.code === "ENOENT" ? "Not found" : "Server error");
      return;
    }

    response.writeHead(200, {
      "Content-Type": contentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "SAMEORIGIN",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    });
    response.end(request.method === "HEAD" ? undefined : content);
  });
});

async function start() {
  const rest = new REST({ version: "10" }).setToken(token);

  console.log("Registering slash commands...");
  await rest.put(Routes.applicationCommands(clientId), { body: commands });

  client.once(Events.ClientReady, (readyClient) => {
    console.log(`Logged in as ${readyClient.user.tag}`);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === "hello") {
      await interaction.reply("Hello World!");
    }
  });

  await client.login(token);

  const port = Number(process.env.SERVER_PORT || process.env.PORT || 3000);
  webServer.listen(port, "0.0.0.0", () => {
    console.log(`Ritmo website listening on 0.0.0.0:${port}`);
  });
}

start().catch((error) => {
  console.error("Failed to start the bot and website:", error);
  process.exitCode = 1;
});
