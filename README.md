# Tumsenoubot v2.0 — Minecraft + Discord + Claude AI

Bot Minecraft intelligent contrôlé en langage naturel via Discord, propulsé par Claude AI.

---

## Installation

### 1. Node.js
Télécharge et installe : https://nodejs.org

### 2. Créer le bot Discord
1. Va sur https://discord.com/developers/applications
2. **New Application** → donne un nom (ex: Tumsenoubot)
3. Onglet **Bot** → **Add Bot**
4. Copie le **Token** → colle dans `.env` à `DISCORD_TOKEN=`
5. Active **Message Content Intent** (dans Bot → Privileged Gateway Intents)
6. Onglet **OAuth2 → URL Generator** :
   - Coche `bot`
   - Coche permissions : `Send Messages`, `Read Message History`, `View Channels`
7. Copie l'URL générée → ouvre dans le navigateur → invite le bot sur ton serveur

### 3. Récupérer l'ID du channel Discord
1. Dans Discord : Paramètres → Avancé → Active **Mode développeur**
2. Clic droit sur ton channel dédié → **Copier l'ID**
3. Colle dans `.env` à `DISCORD_CHANNEL_ID=`

### 4. Clé API Anthropic (Claude)
1. Va sur https://console.anthropic.com
2. **API Keys** → **Create Key**
3. Colle dans `.env` à `ANTHROPIC_API_KEY=sk-ant-...`

### 5. Remplir le .env
```
SERVER_HOST=darkail.mine.fun
SERVER_PORT=25565
MC_VERSION=1.21.11
BOT_USERNAME=Tumsenou@email.com
DISCORD_TOKEN=ton_token
DISCORD_CHANNEL_ID=ton_channel_id
ANTHROPIC_API_KEY=sk-ant-...
```

### 6. Lancer
```
start.bat
```

---

## Utilisation

Écris directement dans le channel Discord en français naturel :

| Ce que tu dis | Ce que le bot fait |
|---|---|
| "viens me rejoindre" | Se déplace vers toi |
| "va au 100 64 200" | Marche jusqu'aux coordonnées |
| "c'est quoi ta position ?" | Répond avec pos/vie/faim |
| "dis bonjour dans le chat" | Écrit dans le chat MC |
| "reste en AFK" | Mode AFK, anti-kick |
| "attaque le zombie" | Attaque le mob le plus proche |
| "ramasse les items" | Va vers les items au sol |
| "arrête-toi" | Stop le déplacement |

**Commande spéciale :**
- `!reset` → réinitialise la mémoire de conversation avec Claude

---

## Structure des fichiers
```
tumsenoubot/
├── bot.js          → Orchestrateur principal
├── ai.js           → Interface Claude AI
├── actions.js      → Actions Minecraft
├── .env            → Configuration (ne pas partager !)
├── start.bat       → Lancement Windows
├── package.json    → Dépendances Node
└── logs/           → Logs de session
```
