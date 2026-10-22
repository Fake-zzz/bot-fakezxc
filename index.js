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
  throw new Error("Missing DISCORD_TOKEN environment variable.");
}

if (!clientId) {
  throw new Error("Missing DISCORD_CLIENT_ID environment variable.");
}

const commands = [
  new SlashCommandBuilder()
    .setName("hello")
    .setDescription("Replies with Hello World!"),
].map((command) => command.toJSON());

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
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
}

start().catch((error) => {
  console.error("Failed to start the bot:", error);
  process.exitCode = 1;
});
