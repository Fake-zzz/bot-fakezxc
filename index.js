const { loadEnvFile } = require("node:process");
const {
  Client,
  Events,
  EmbedBuilder,
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
  if (task.repeat_frequency === "monthly") {
    return Number(task.repeat_month_day || 0) === Number(date.slice(8, 10));
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
    if(notification.type==="discord_setup"){
      const embed=new EmbedBuilder().setColor(0x5865f2).setAuthor({name:"Ritmo · Configuração concluída"}).setTitle("Tudo pronto para começar ✨").setDescription("Sua conta do Discord já está conectada ao Ritmo. Vou enviar seus lembretes e resumos por mensagem direta, conforme as preferências no site.").setFooter({text:"Ajuste as notificações a qualquer momento nas configurações do Ritmo."}).setTimestamp(new Date());
      await user.send({embeds:[embed]});
    }else if(notification.type==="goal_achieved"){
      const details=notification.details||{};
      const embed=new EmbedBuilder().setColor(0xe3b85c).setAuthor({name:"Ritmo · Meta alcançada"}).setTitle("✨ Você chegou lá: "+details.name).setDescription("A meta foi concluída neste período. Cada registro aproximou você do resultado.").addFields({name:"Progresso",value:String(details.total)+" / "+String(details.target)+" "+String(details.unit||""),inline:true}).setFooter({text:"Um passo de cada vez."}).setTimestamp(new Date());
      await user.send({embeds:[embed]});
    }else if(notification.type==="task_reminder"){
      const details=notification.details||{};
      const repeatLabel={once:"Tarefa única",daily:"Tarefa diária",weekly:"Tarefa semanal",monthly:"Tarefa mensal"}[details.repeat_frequency]||"Tarefa";
      const description=details.description||"Está na hora de cuidar do próximo passo.";
      const dateLabel=new Intl.DateTimeFormat("pt-BR",{weekday:"long",day:"numeric",month:"long",timeZone:profile.timezone||"America/Sao_Paulo"}).format(new Date((details.date||"")+"T12:00:00Z"));
      const embed=new EmbedBuilder()
        .setColor(0x57b58a)
        .setAuthor({name:"Ritmo · Lembrete"})
        .setTitle("⏰ Hora de fazer: "+details.title)
        .setDescription(description)
        .addFields(
          {name:"Quando",value:dateLabel+" às "+(details.time||"--:--"),inline:true},
          {name:"Tipo",value:repeatLabel,inline:true},
          {name:"Seu espaço",value:"Marque a tarefa como concluída no Ritmo quando terminar.",inline:false}
        )
        .setFooter({text:"Um passo de cada vez."})
        .setTimestamp(new Date());
      await user.send({embeds:[embed]});
    }else{
      await user.send(notification.message);
    }
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
  if (!profile.discord_notifications_enabled || !profile.notify_tasks) return;
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
      details: { title: task.title, description: task.description || "", date: nowParts.date, time: scheduled, repeat_frequency: task.repeat_frequency },
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

function addCalendarMonths(key,months){
  const parts=key.split("-").map(Number),first=new Date(Date.UTC(parts[0],parts[1]-1+months,1,12));
  const last=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0,12)).getUTCDate();
  first.setUTCDate(Math.min(parts[2],last));
  return first.toISOString().slice(0,10);
}

function habitPeriodRange(habit,date){
  const anchor=habit.started_on||date,unit=habit.period_unit||"day",interval=Math.max(1,Number(habit.period_interval||1));
  let start=anchor,next;
  if(unit==="day"||unit==="week"){
    const length=interval*(unit==="week"?7:1);
    start=dateOffset(anchor,Math.floor(daysBetween(anchor,date)/length)*length);
    next=dateOffset(start,length);
  }else{
    const months=interval*(unit==="year"?12:1);
    let count=Math.max(0,Math.floor(((Number(date.slice(0,4))-Number(anchor.slice(0,4)))*12+Number(date.slice(5,7))-Number(anchor.slice(5,7)))/months));
    start=addCalendarMonths(anchor,count*months);
    while(start>date&&count>0)start=addCalendarMonths(anchor,--count*months);
    while(addCalendarMonths(anchor,(count+1)*months)<=date)start=addCalendarMonths(anchor,++count*months);
    next=addCalendarMonths(anchor,(count+1)*months);
  }
  return {start,end:dateOffset(next,-1)};
}

async function sendGoalNotifications(profile,nowParts){
  if(!profile.discord_notifications_enabled||!profile.notify_goals)return;
  const userFilter="user_id=eq."+encodeURIComponent(profile.user_id);
  const [goals,progress]=await Promise.all([
    getRows("goals","select=*&"+userFilter+"&is_active=eq.true"),
    getRows("goal_progress_entries","select=goal_id,entry_date,amount&"+userFilter+"&entry_date=gte."+dateOffset(nowParts.date,-32)+"&entry_date=lte."+nowParts.date)
  ]);
  for(const goal of goals){
    if((goal.starts_on&&nowParts.date<goal.starts_on)||(goal.ends_on&&nowParts.date>goal.ends_on))continue;
    const range=periodRange(goal,nowParts.date);
    const total=progress.filter((entry)=>entry.goal_id===goal.id&&entry.entry_date>=range.start&&entry.entry_date<=range.end).reduce((sum,entry)=>sum+Number(entry.amount||0),0);
    if(total<Number(goal.target_value))continue;
    await postNotification(profile,{
      dedupeKey:"goal:"+goal.id+":"+range.start,type:"goal_achieved",entityId:goal.id,
      details:{name:goal.name,total,target:goal.target_value,unit:goal.unit},
      message:"✨ Meta alcançada: "+goal.name+" ("+total+"/"+goal.target_value+" "+goal.unit+")."
    });
  }
}

async function sendSetupConfirmation(profile){
  if(!profile.discord_linked_at||profile.discord_setup_notified_at)return;
  const linkedAt=new Date(profile.discord_linked_at),dedupeKey="discord_setup:"+profile.user_id+":"+linkedAt.getTime();
  await postNotification(profile,{
    dedupeKey,type:"discord_setup",details:{linked_at:profile.discord_linked_at},
    message:"Sua configuração do Ritmo está pronta. As mensagens diretas serão enviadas conforme suas preferências no site."
  });
  const rows=await getRows("notification_log","select=status&dedupe_key=eq."+encodeURIComponent(dedupeKey)+"&limit=1");
  if(rows&&rows[0]&&rows[0].status==="sent"){
    const notifiedAt=new Date().toISOString();
    await supabaseRequest("ritmo?user_id=eq."+encodeURIComponent(profile.user_id),{
      method:"PATCH",headers:{Prefer:"return=minimal"},body:{discord_setup_notified_at:notifiedAt}
    });
    profile.discord_setup_notified_at=notifiedAt;
  }
}

async function sendDailySummary(profile, nowParts) {
  if (!profile.discord_notifications_enabled || !profile.daily_summary_enabled) return;
  const currentMinutes = Number(nowParts.time.slice(0, 2)) * 60 + Number(nowParts.time.slice(3, 5));
  const summaryTime = String(profile.daily_summary_time || "21:00").slice(0, 5);
  const summaryMinutes = Number(summaryTime.slice(0, 2)) * 60 + Number(summaryTime.slice(3, 5));
  if (currentMinutes < summaryMinutes) return;

  const userFilter = "user_id=eq." + encodeURIComponent(profile.user_id);
  const [tasks, checkins, goals, progress, habits, countEntries] = await Promise.all([
    getRows("tasks", "select=*&" + userFilter + "&is_active=eq.true"),
    getRows("task_checkins", "select=task_id,status&" + userFilter + "&occurrence_date=eq." + nowParts.date),
    getRows("goals", "select=*&" + userFilter + "&is_active=eq.true"),
    getRows("goal_progress_entries", "select=goal_id,entry_date,amount&" + userFilter + "&entry_date=gte." + dateOffset(nowParts.date, -31) + "&entry_date=lte." + nowParts.date),
    getRows("habits", "select=*&" + userFilter + "&is_active=eq.true"),
    getRows("habit_count_entries", "select=habit_id,entry_date,amount&" + userFilter)
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
    if(habit.category==="count"){
      const range=habitPeriodRange(habit,nowParts.date);
      const total=countEntries.filter((entry)=>entry.habit_id===habit.id&&entry.entry_date>=range.start&&entry.entry_date<=range.end).reduce((sum,entry)=>sum+Number(entry.amount||0),0);
      const reached=habit.count_polarity==="negative"?total<Number(habit.target_count):total>=Number(habit.target_count);
      return (reached?"✅ ":"⬜ ")+habit.name+": "+total+"/"+habit.target_count+" "+(habit.measure_unit||"vezes")+" no período.";
    }
    const days = daysBetween(habit.current_streak_started_on, nowParts.date);
    return "✳ " + habit.name + ": " + days + (days === 1 ? " dia" : " dias") + ".";
  });

  const body = ["📋 **Resumo do dia — " + nowParts.date + "**"];
  if (profile.notify_tasks) body.push(...taskLines);
  if (profile.notify_goals) body.push(...(goalLines.length ? ["Metas:", ...goalLines] : ["Metas: nenhuma ativa."]));
  if (profile.notify_habit_milestones) body.push(...(habitLines.length ? ["Hábitos:", ...habitLines] : ["Hábitos: nenhum ativo."]));

  await postNotification(profile, {
    dedupeKey: "summary:" + nowParts.date,
    type: "daily_summary",
    details: { date: nowParts.date },
    message: body
  });
}

function addUtcMonths(date,months){
  const result=new Date(date),day=result.getUTCDate();
  result.setUTCDate(1);result.setUTCMonth(result.getUTCMonth()+months);
  const last=new Date(Date.UTC(result.getUTCFullYear(),result.getUTCMonth()+1,0)).getUTCDate();
  result.setUTCDate(Math.min(day,last));
  return result;
}

function quitMilestones(start){
  const values=[];
  for(const days of [1,2,3,7,14,21,28]){
    const date=new Date(start);date.setUTCDate(date.getUTCDate()+days);
    values.push({date,label:days<7?days+" dia(s)":(days/7)+" semana(s)"});
  }
  for(let month=1;month<=6;month+=1)values.push({date:addUtcMonths(start,month),label:month+" mês(es)"});
  for(let year=1;year<=100;year+=1)values.push({date:addUtcMonths(start,year*12),label:year+" ano(s)"});
  return values;
}

async function sendHabitMilestones(profile,nowParts){
  if(!profile.discord_notifications_enabled||!profile.notify_habit_milestones)return;
  const userFilter="user_id=eq."+encodeURIComponent(profile.user_id);
  const habits=await getRows("habits","select=*&"+userFilter+"&is_active=eq.true&category=eq.quit&notify_milestones=eq.true");
  const now=new Date();
  for(const habit of habits){
    const start=new Date(habit.quit_started_at||((habit.current_streak_started_on||habit.started_on)+"T00:00:00Z"));
    if(Number.isNaN(start.getTime()))continue;
    for(const milestone of quitMilestones(start)){
      const local=localDateTime(milestone.date,profile.timezone);
      if(local.date<nowParts.date)continue;
      if(local.date>nowParts.date)break;
      if(milestone.date>now)break;
      const dedupeKey="habit:"+habit.id+":quit:"+milestone.label+":"+milestone.date.toISOString();
      await postNotification(profile,{
        dedupeKey,type:"habit_milestone",entityId:habit.id,
        details:{name:habit.name,milestone:milestone.label,at:milestone.date.toISOString()},
        message:"✳ **Marco alcançado: "+milestone.label+" sem "+habit.name+"!** Continue no seu ritmo."
      });
      break;
    }
  }
}

async function runNotificationCycle() {
  if (!supabaseUrl || !supabaseServerKey || notificationCycleRunning) return;
  notificationCycleRunning = true;
  try {
    const profiles = await getRows(
      "ritmo",
      "select=user_id,timezone,discord_user_id,daily_summary_enabled,daily_summary_time,discord_notifications_enabled,notify_tasks,notify_goals,notify_habit_milestones,discord_linked_at,discord_setup_notified_at&discord_user_id=not.is.null"
    );
    for (const profile of profiles) {
      if (!profile.discord_user_id) continue;
      profile.timezone = profile.timezone || "America/Sao_Paulo";
      profile.discord_notifications_enabled = profile.discord_notifications_enabled !== false;
      profile.notify_tasks = profile.notify_tasks !== false;
      profile.notify_goals = profile.notify_goals !== false;
      profile.notify_habit_milestones = profile.notify_habit_milestones !== false;
      await sendSetupConfirmation(profile);
      const nowParts = localDateTime(new Date(), profile.timezone);
      await sendTaskReminders(profile, nowParts);
      await sendHabitMilestones(profile, nowParts);
      await sendGoalNotifications(profile, nowParts);
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
