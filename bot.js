require('dotenv').config()
const mineflayer = require('mineflayer')
const { Client, GatewayIntentBits } = require('discord.js')
const fs = require('fs')
const path = require('path')
const { askClaude, askClaudeChat, clearHistory } = require('./ai')
const { initPathfinder, executeAction } = require('./actions')
const { startSurvival, stopSurvival } = require('./survival')
const { taskMakePick, taskMakeSword, taskSmelt } = require('./task')

// ── Logs ──────────────────────────────────────────────────────────
const logsDir = path.join(__dirname, 'logs')
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir)
const logFile = path.join(logsDir, `session_${new Date().toISOString().replace(/[:.]/g, '-')}.log`)
const logStream = fs.createWriteStream(logFile, { flags: 'a' })

function log(msg) {
  const now = new Date().toLocaleTimeString('fr-FR')
  const line = `[${now}] ${msg}`
  console.log(line)
  logStream.write(line + '\n')
}

process.on('uncaughtException', (err) => { log(`[CRASH] ${err.message}\n${err.stack}`); logStream.end(); process.exit(1) })
process.on('unhandledRejection', (reason) => { log(`[CRASH] ${reason}`); logStream.end(); process.exit(1) })

// ── Discord ───────────────────────────────────────────────────────
const discord = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
})

let discordChannel = null

discord.once('clientReady', () => {
  log(`Discord connecté: ${discord.user.tag}`)
  discordChannel = discord.channels.cache.get(process.env.DISCORD_CHANNEL_ID)
  if (!discordChannel) { log('⚠️ Channel Discord introuvable'); return }
  log(`Channel: #${discordChannel.name}`)
  discordChannel.send('🟢 **Tumsenoubot en ligne !**')
})

function sendDiscord(msg) {
  if (discordChannel) discordChannel.send(msg).catch(err => log(`Discord err: ${err.message}`))
}

// ── Minecraft ─────────────────────────────────────────────────────
let bot = null
let reconnectTimer = null
const BOT_NAME = 'Dark__L'

function getBotState() {
  if (!bot?.entity) return { x:'?', y:'?', z:'?', health:'?', food:'?', inventory:'inconnu' }
  const pos = bot.entity.position
  return {
    x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z),
    health: Math.floor(bot.health ?? 0), food: Math.floor(bot.food ?? 0),
    inventory: bot.inventory.items().map(i => `${i.name} x${i.count}`).join(', ') || 'vide'
  }
}

function createBot() {
  log('Connexion à darkail.mine.fun...')
  bot = mineflayer.createBot({
    host: process.env.SERVER_HOST,
    port: parseInt(process.env.SERVER_PORT) || 25565,
    username: process.env.BOT_USERNAME,
    auth: 'microsoft',
    version: process.env.MC_VERSION || '1.21.11',
    onMsaCode: (data) => {
      const code = data.user_code || data.userCode || '?'
      const url = data.verification_uri || 'https://www.microsoft.com/link'
      const mins = data.expires_in ? Math.floor(data.expires_in / 60) : '?'
      sendDiscord(`🔐 **Auth Microsoft !**\n1. ${url}\n2. Code: \`${code}\`\n3. Valide sur ton app\n⏱️ ${mins} min`)
    }
  })

  bot.once('spawn', () => {
    log('Spawné !')
    initPathfinder(bot)
    startSurvival(bot, log, sendDiscord)
    sendDiscord('✅ **Connecté** sur darkail.mine.fun')
  })

  bot.on('login', () => log(`Connecté: ${bot.username}`))
  bot.on('death', () => { log('Mort !'); sendDiscord('💀 **Je suis mort !**'); stopSurvival() })

  bot.on('chat', async (username, message) => {
    if (username === bot.username) return
    if (message.toLowerCase().includes(BOT_NAME.toLowerCase())) {
      await new Promise(r => setTimeout(r, 800))
      const reply = await askClaudeChat(username, message)
      if (reply) { bot.chat(reply); sendDiscord(`💬 **${username}** → "${message}"\n🤖 → ${reply}`) }
    }
  })

  bot.on('kicked', (reason) => { log(`Kické: ${reason}`); sendDiscord(`🔴 Kické: ${reason}`); stopSurvival(); scheduleReconnect() })
  bot.on('error', (err) => { log(`Err: ${err.message}`); stopSurvival(); scheduleReconnect() })
  bot.on('end', () => { log('Déco'); sendDiscord('🔴 Déconnecté, reconnexion 30s...'); stopSurvival(); scheduleReconnect() })
}

function scheduleReconnect() {
  if (reconnectTimer) return
  reconnectTimer = setTimeout(() => { reconnectTimer = null; createBot() }, 30000)
}

// ── Exécution d'une action ────────────────────────────────────────
async function runAction(action) {
  if (!bot?.entity) { sendDiscord('❌ Pas encore connecté en jeu.'); return }

  try {
    // Tâches autonomes complexes
    if (action.action === 'make_pick') {
      sendDiscord(`🔨 Je fabrique une pioche en ${action.material || 'bois'}...`)
      const result = await taskMakePick(bot, action.material || 'bois', log, sendDiscord)
      sendDiscord(result)
      return
    }

    if (action.action === 'make_sword') {
      sendDiscord(`⚔️ Je fabrique une épée en ${action.material || 'bois'}...`)
      const result = await taskMakeSword(bot, action.material || 'bois', log, sendDiscord)
      sendDiscord(result)
      return
    }

    if (action.action === 'make_axe') {
      sendDiscord(`🪓 Je fabrique une hache en ${action.material || 'bois'}...`)
      const result = await taskMakePick(bot, action.material || 'bois', log, sendDiscord)
      sendDiscord(result)
      return
    }

    if (action.action === 'smelt') {
      sendDiscord(`🔥 Cuisson de ${action.what}...`)
      const result = await taskSmelt(bot, action.what, action.count || 1, log, sendDiscord)
      sendDiscord(result)
      return
    }

    if (action.action === 'make_gear') {
      // Fait un stuff complet de base automatiquement
      sendDiscord('⚒️ Je me fais un stuff de base complet ! Ça va prendre un moment...')
      sendDiscord('🪓 Étape 1/4: Pioche en bois...')
      await taskMakePick(bot, 'bois', log, sendDiscord)
      sendDiscord('⛏️ Étape 2/4: Pioche en pierre...')
      await taskMakePick(bot, 'pierre', log, sendDiscord)
      sendDiscord('⚔️ Étape 3/4: Épée en pierre...')
      await taskMakeSword(bot, 'pierre', log, sendDiscord)
      sendDiscord('🔥 Étape 4/4: Four pour cuire...')
      await taskSmelt(bot, 'fer', 3, log, sendDiscord)
      sendDiscord('✅ Stuff de base terminé !')
      return
    }

    // Actions standard
    const response = await executeAction(bot, action, log, sendDiscord)
    sendDiscord(response)

  } catch (err) {
    log(`Erreur action: ${err.message}`)
    sendDiscord(`❌ Erreur: ${err.message}`)
  }
}

// ── Gestion Discord ───────────────────────────────────────────────
discord.on('messageCreate', async (message) => {
  if (message.author.bot) return
  if (message.channelId !== process.env.DISCORD_CHANNEL_ID) return
  const content = message.content.trim()
  if (!content) return
  log(`Discord [${message.author.username}]: ${content}`)

  // Commandes spéciales
  if (content.toLowerCase() === '!reset') { clearHistory(); sendDiscord('🔄 Historique réinitialisé.'); return }
  if (content.toLowerCase() === '!survie on') { startSurvival(bot, log, sendDiscord); sendDiscord('🛡️ Survie ON.'); return }
  if (content.toLowerCase() === '!survie off') { stopSurvival(); sendDiscord('⚠️ Survie OFF.'); return }
  if (content.toLowerCase() === '!status') {
    const s = getBotState()
    sendDiscord(`📍 X:${s.x} Y:${s.y} Z:${s.z} | ❤️${s.health}/20 | 🍖${s.food}/20\n🎒 ${s.inventory}`)
    return
  }

  message.channel.sendTyping()

  const state = getBotState()
  const result = await askClaude(content, state)

  if (result.type === 'action') {
    // ── Exécute l'action SANS afficher le JSON ──────────────────
    log(`Action: ${JSON.stringify(result.data)}`)
    await runAction(result.data)
  } else {
    // Réponse texte normale
    sendDiscord(result.data)
  }
})

// ── Démarrage ─────────────────────────────────────────────────────
log('=== Tumsenoubot v3.0 démarrage ===')
discord.login(process.env.DISCORD_TOKEN).then(() => createBot()).catch(err => { log(`Discord err: ${err.message}`); process.exit(1) })
process.on('SIGINT', () => { stopSurvival(); if (bot) bot.quit('Arrêt'); discord.destroy(); logStream.end(); process.exit(0) })
