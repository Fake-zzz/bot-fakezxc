const { loadEnvFile } = require("node:process");
const {
  Client,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder
} = require("discord.js");

try {
  loadEnvFile();
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const discordToken = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const supabaseUrl = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const supabaseServerKey = process.env.SUPABASE_SERVER_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!discordToken) throw new Error("Missing DISCORD_TOKEN.");
if (!clientId) throw new Error("Missing DISCORD_CLIENT_ID.");

const commands = [
  new SlashCommandBuilder()
    .setName("hello")
    .setDescription("Replies with Hello World!")
].map((command) => command.toJSON());

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
let notificationCycleRunning = false;

function supabaseHeaders(extra = {}) {
  if (!supabaseServerKey) throw new Error("Missing SUPABASE_SERVER_KEY.");
  const headers = {
    apikey: supabaseServerKey,
    "Content-Type": "application/json",
    ...extra
  };
  // Modern sb_secret keys are not JWTs; legacy service_role keys are JWTs.
  if (!supabaseServerKey.startsWith("sb_secret_")) {
    headers.Authorization = "Bearer " + supabaseServerKey;
  }
  return headers;
}

async function supabaseRequest(path, options = {}) {
  const response = await fetch(supabaseUrl + "/rest/v1/" + path, {
    method: options.method || "GET",
    headers: supabaseHeaders(options.headers || {}),
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error("Supabase HTTP " + response.status + ": " + text.slice(0, 500));
  }
  return text ? JSON.parse(text) : null;
}

function zonedParts(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const values = {};
  parts.forEach((part) => { values[part.type] = part.value; });
  return values;
}

function localDateTime(date, timezone) {
  const parts = zonedParts(date, timezone);
  return {
    date: parts.year + "-" + parts.month + "-" + parts.day,
    time: parts.hour + ":" + parts.minute
  };
}

function weekdayForDate(date) {
  return new Date(date + "T00:00:00Z").getUTCDay();
}

function daysBetween(start, end) {
  const from = start.split("-").map(Number);
  const to = end.split("-").map(Number);
  return Math.max(0, Math.floor(
    (Date.UTC(to[0], to[1] - 1, to[2]) - Date.UTC(from[0], from[1] - 1, from[2])) / 86400000
  ));
}

function occursOn(task, date, timezone = "America/Sao_Paulo") {
  if (!task.is_active) return false;
  if (task.repeat_frequency === "once") {
    return localDateTime(new Date(task.scheduled_at), timezone).date === date;
  }
  if (date < task.starts_on || (task.ends_on && date > task.ends_on)) return false;
  if (task.repeat_frequency === "daily") return true;
  if (task.repeat_frequency === "weekly") {
    return (task.repeat_days || []).map(Number).includes(weekdayForDate(date));
  }
  return false;
}

async function getRows(table, query) {
  return supabaseRequest(table + "?" + query);
}

async function postNotification(profile, notification) {
  const path = "notification_log?on_conflict=dedupe_key";
  const row = {
    user_id: profile.user_id,
    dedupe_key: notification.dedupeKey,
    notification_type: notification.type,
    entity_id: notification.entityId || null,
    scheduled_for: new Date().toISOString(),
    status: "pending",
    attempt_count: 1,
    updated_at: new Date().toISOString(),
    details: notification.details || {}
  };

  const inserted = await supabaseRequest(path, {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
    body: row
  });
  if (inserted && inserted.length) {
    return deliverNotification(profile, notification, row.dedupe_key);
  }

  const existingRows = await getRows(
    "notification_log",
    "select=id,status,updated_at,attempt_count&dedupe_key=eq." + encodeURIComponent(notification.dedupeKey) + "&limit=1"
  );
  const existing = existingRows && existingRows[0];
  if (!existing || existing.status === "sent") return;

  const age = Date.now() - new Date(existing.updated_at).getTime();
  if (age < 5 * 60 * 1000) return;

  await supabaseRequest(
    "notification_log?dedupe_key=eq." + encodeURIComponent(notification.dedupeKey),
    {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: {
        status: "pending",
        updated_at: new Date().toISOString(),
        attempt_count: Number(existing.attempt_count || 0) + 1,
        last_error: null
      }
    }
  );
  return deliverNotification(profile, notification, notification.dedupeKey);
}

async function deliverNotification(profile, notification, dedupeKey) {
  try {
    const user = await client.users.fetch(profile.discord_user_id);
    await user.send(notification.message);
    await supabaseRequest(
      "notification_log?dedupe_key=eq." + encodeURIComponent(dedupeKey),
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: { status: "sent", sent_at: new Date().toISOString(), updated_at: new Date().toISOString(), last_error: null }
      }
    );
    console.log("Sent " + notification.type + " notification to Discord user " + profile.discord_user_id + ".");
  } catch (error) {
    await supabaseRequest(
      "notification_log?dedupe_key=eq." + encodeURIComponent(dedupeKey),
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: { status: "failed", last_error: String(error.message || error).slice(0, 500), updated_at: new Date().toISOString() }
      }
    );
    console.error("Discord notification failed:", error.message || error);
  }
}

async function sendTaskReminders(profile, nowParts) {
  const userFilter = "user_id=eq." + encodeURIComponent(profile.user_id);
  const tasks = await getRows("tasks", "select=*&" + userFilter + "&is_active=eq.true");
  const todayCheckins = await getRows(
    "task_checkins",
    "select=task_id,status&" + userFilter + "&occurrence_date=eq." + nowParts.date
  );
  const completed = new Set(todayCheckins.filter((row) => row.status === "completed").map((row) => row.task_id));

  for (const task of tasks) {
    if (completed.has(task.id)) continue;
    // One-time scheduled_at values are UTC instants; repeating times use the profile timezone.
    const scheduled = task.repeat_frequency === "once"
      ? localDateTime(new Date(task.scheduled_at), profile.timezone).time
      : String(task.reminder_time || "").slice(0, 5);
    const currentMinutes = Number(nowParts.time.slice(0, 2)) * 60 + Number(nowParts.time.slice(3, 5));
    const scheduledMinutes = Number(scheduled.slice(0, 2)) * 60 + Number(scheduled.slice(3, 5));
    if (!task.reminder_enabled || !occursOn(task, nowParts.date, profile.timezone) ||
        currentMinutes < scheduledMinutes || currentMinutes >= scheduledMinutes + 5) continue;

    const note = task.description ? "\n" + task.description : "";
    await postNotification(profile, {
      dedupeKey: "task:" + task.id + ":" + nowParts.date,
      type: "task_reminder",
      entityId: task.id,
      details: { title: task.title, date: nowParts.date },
      message: "⏰ Hora da tarefa: **" + task.title + "**." + note
    });
  }
}

function periodRange(goal, today) {
  if (goal.period === "weekly") {
    const weekday = weekdayForDate(today);
    const mondayOffset = (weekday + 6) % 7;
    const start = dateOffset(today, -mondayOffset);
    return { start, end: today };
  }
  if (goal.period === "monthly") return { start: today.slice(0, 8) + "01", end: today };
  return { start: today, end: today };
}

function dateOffset(date, days) {
  const parts = date.split("-").map(Number);
  const value = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + days, 12));
  return value.toISOString().slice(0, 10);
}

async function sendDailySummary(profile, nowParts) {
  if (!profile.daily_summary_enabled) return;
  const currentMinutes = Number(nowParts.time.slice(0, 2)) * 60 + Number(nowParts.time.slice(3, 5));
  const summaryTime = String(profile.daily_summary_time || "21:00").slice(0, 5);
  const summaryMinutes = Number(summaryTime.slice(0, 2)) * 60 + Number(summaryTime.slice(3, 5));
  if (currentMinutes < summaryMinutes) return;

  const userFilter = "user_id=eq." + encodeURIComponent(profile.user_id);
  const [tasks, checkins, goals, progress, habits] = await Promise.all([
    getRows("tasks", "select=*&" + userFilter + "&is_active=eq.true"),
    getRows("task_checkins", "select=task_id,status&" + userFilter + "&occurrence_date=eq." + nowParts.date),
    getRows("goals", "select=*&" + userFilter + "&is_active=eq.true"),
    getRows("goal_progress_entries", "select=goal_id,entry_date,amount&" + userFilter + "&entry_date=gte." + dateOffset(nowParts.date, -31) + "&entry_date=lte." + nowParts.date),
    getRows("habits", "select=*&" + userFilter + "&is_active=eq.true")
  ]);

  const todaysTasks = tasks.filter((task) => occursOn(task, nowParts.date, profile.timezone));
  const completedTasks = new Set(checkins.filter((row) => row.status === "completed").map((row) => row.task_id));
  const taskDone = todaysTasks.filter((task) => completedTasks.has(task.id)).length;
  const taskLines = todaysTasks.length
    ? ["Tarefas: " + taskDone + "/" + todaysTasks.length + " concluídas."]
    : ["Tarefas: nenhuma agendada para hoje."];

  const goalLines = goals.map((goal) => {
    const range = periodRange(goal, nowParts.date);
    const total = progress
      .filter((entry) => entry.goal_id === goal.id && entry.entry_date >= range.start && entry.entry_date <= range.end)
      .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
    const mark = total >= Number(goal.target_value) ? "✅" : "⬜";
    return mark + " " + goal.name + ": " + total + "/" + goal.target_value + " " + goal.unit + ".";
  });

  const habitLines = habits.map((habit) => {
    const days = daysBetween(habit.current_streak_started_on, nowParts.date);
    return "✳ " + habit.name + ": " + days + (days === 1 ? " dia" : " dias") + ".";
  });

  const body = ["📋 **Resumo do dia — " + nowParts.date + "**"]
    .concat(taskLines)
    .concat(goalLines.length ? ["Metas:", ...goalLines] : ["Metas: nenhuma ativa."])
    .concat(habitLines.length ? ["Hábitos:", ...habitLines] : ["Hábitos: nenhum ativo."])
    .join("\n");

  await postNotification(profile, {
    dedupeKey: "summary:" + nowParts.date,
    type: "daily_summary",
    details: { date: nowParts.date },
    message: body
  });
}

async function sendHabitMilestones(profile, nowParts) {
  const userFilter = "user_id=eq." + encodeURIComponent(profile.user_id);
  const habits = await getRows("habits", "select=*&" + userFilter + "&is_active=eq.true");
  const currentMinutes = Number(nowParts.time.slice(0, 2)) * 60 + Number(nowParts.time.slice(3, 5));
  if (currentMinutes < 9 * 60) return;

  for (const habit of habits) {
    const interval = Math.max(1, Number(habit.notification_interval_days || 5));
    const days = daysBetween(habit.current_streak_started_on, nowParts.date);
    if (days < 1 || days % interval !== 0) continue;
    await postNotification(profile, {
      dedupeKey: "habit:" + habit.id + ":milestone:" + nowParts.date + ":" + days,
      type: "habit_milestone",
      entityId: habit.id,
      details: { name: habit.name, day: days, date: nowParts.date },
      message: "✳ Você completou **" + days + " dias** acompanhando o hábito **" + habit.name + "**. Continue no seu ritmo!"
    });
  }
}

async function runNotificationCycle() {
  if (!supabaseUrl || !supabaseServerKey || notificationCycleRunning) return;
  notificationCycleRunning = true;
  try {
    const profiles = await getRows(
      "ritmo",
      "select=user_id,timezone,discord_user_id,daily_summary_enabled,daily_summary_time&discord_user_id=not.is.null"
    );
    for (const profile of profiles) {
      if (!profile.discord_user_id) continue;
      profile.timezone = profile.timezone || "America/Sao_Paulo";
      const nowParts = localDateTime(new Date(), profile.timezone);
      await sendTaskReminders(profile, nowParts);
      await sendHabitMilestones(profile, nowParts);
      await sendDailySummary(profile, nowParts);
    }
  } catch (error) {
    console.error("Supabase notification cycle failed:", error.message || error);
  } finally {
    notificationCycleRunning = false;
  }
}

async function start() {
  const rest = new REST({ version: "10" }).setToken(discordToken);
  console.log("Registering slash commands...");
  await rest.put(Routes.applicationCommands(clientId), { body: commands });

  client.once(Events.ClientReady, (readyClient) => {
    console.log("Logged in as " + readyClient.user.tag);
    if (supabaseUrl && supabaseServerKey) {
      console.log("Ritmo Supabase notification scheduler enabled.");
      runNotificationCycle();
      setInterval(runNotificationCycle, 30000);
    } else {
      console.log("Supabase reminders are disabled until SUPABASE_URL and SUPABASE_SERVER_KEY are set.");
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName === "hello") await interaction.reply("Hello World!");
  });

  await client.login(discordToken);
}

start().catch((error) => {
  console.error("Failed to start the bot:", error);
  process.exitCode = 1;
});
