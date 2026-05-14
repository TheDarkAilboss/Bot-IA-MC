const { Movements, goals } = require('mineflayer-pathfinder')
const Vec3 = require('vec3')

function initPathfinder(bot) {
  const { pathfinder } = require('mineflayer-pathfinder')
  bot.loadPlugin(pathfinder)
}

function getMovements(bot, canDig = false) {
  const mcData = require('minecraft-data')(bot.version)
  const movements = new Movements(bot, mcData)
  movements.canDig = canDig
  movements.allowSprinting = true
  return movements
}

// ── Utilitaire : trouver le meilleur outil pour un bloc ───────────
async function equipBestTool(bot, block) {
  const mcData = require('minecraft-data')(bot.version)
  const items = bot.inventory.items()
  let bestItem = null
  let bestSpeed = 0

  for (const item of items) {
    const tool = mcData.items[item.type]
    if (!tool) continue
    // Heuristique simple sur le nom de l'outil
    const name = tool.name
    if (block.name.includes('log') || block.name.includes('wood') || block.name.includes('planks')) {
      if (name.includes('axe')) { bestItem = item; break }
    } else if (block.name.includes('ore') || block.name.includes('stone') || block.name.includes('cobble')) {
      if (name.includes('pickaxe')) { bestItem = item; break }
    } else if (block.name.includes('dirt') || block.name.includes('grass') || block.name.includes('sand')) {
      if (name.includes('shovel')) { bestItem = item; break }
    }
  }

  if (bestItem) await bot.equip(bestItem, 'hand')
}

// ── Utilitaire : miner un type de bloc ───────────────────────────
async function mineBlockType(bot, blockNames, count, log, sendDiscord) {
  const mcData = require('minecraft-data')(bot.version)
  let mined = 0
  const toMine = count || 1

  // Construire la liste des IDs à chercher
  const ids = []
  for (const name of blockNames) {
    if (mcData.blocksByName[name]) ids.push(mcData.blocksByName[name].id)
  }
  if (ids.length === 0) return 0

  while (mined < toMine) {
    const block = bot.findBlock({ matching: ids, maxDistance: 64 })
    if (!block) break

    try {
      bot.pathfinder.setMovements(getMovements(bot, true))
      await bot.pathfinder.goto(new goals.GoalBlock(block.position.x, block.position.y, block.position.z))
      await equipBestTool(bot, block)
      await bot.dig(block)
      mined++
      log(`Miné: ${block.name} (${mined}/${toMine})`)
    } catch (err) {
      log(`Erreur minage: ${err.message}`)
      break
    }
  }
  return mined
}

async function executeAction(bot, action, log, sendDiscord) {
  switch (action.action) {

    // ── DÉPLACEMENT ───────────────────────────────────────────────
    case 'goto': {
      const { x, y, z } = action
      if (x === undefined || z === undefined) return '❌ Coordonnées manquantes.'
      bot.pathfinder.setMovements(getMovements(bot, false))
      bot.pathfinder.setGoal(new goals.GoalBlock(Math.floor(x), Math.floor(y ?? 64), Math.floor(z)))
      return `🏃 Je vais vers X:${x} Y:${y ?? '?'} Z:${z}`
    }

    case 'follow': {
      let target = null
      const playerName = action.player?.toLowerCase()
      for (const [name, data] of Object.entries(bot.players)) {
        if (name.toLowerCase() === playerName && data.entity) { target = data.entity; break }
      }
      if (!target) target = bot.nearestEntity(e => e.type === 'player')
      if (!target) return `❌ Joueur introuvable.`
      bot.pathfinder.setMovements(getMovements(bot, false))
      bot.pathfinder.setGoal(new goals.GoalFollow(target, 2), true)
      return `🚶 Je suis ${target.username || action.player} !`
    }

    case 'stop': {
      bot.pathfinder.setGoal(null)
      bot.clearControlStates()
      return '🛑 Arrêté.'
    }

    // ── INFORMATIONS ──────────────────────────────────────────────
    case 'status': {
      const pos = bot.entity.position
      const players = Object.keys(bot.players).join(', ') || 'personne'
      const inv = bot.inventory.items().map(i => `${i.name} x${i.count}`).join(', ') || 'vide'
      return `📍 X:${Math.floor(pos.x)} Y:${Math.floor(pos.y)} Z:${Math.floor(pos.z)}
❤️ ${bot.health}/20 | 🍖 ${bot.food}/20
👥 Joueurs: ${players}
🎒 ${inv}`
    }

    // ── INTERACTION ───────────────────────────────────────────────
    case 'chat': {
      if (!action.message) return '❌ Message vide.'
      bot.chat(action.message)
      return `💬 "${action.message}"`
    }

    case 'jump': {
      const times = Math.min(action.times || 1, 10)
      for (let i = 0; i < times; i++) {
        bot.setControlState('jump', true)
        await new Promise(r => setTimeout(r, 300))
        bot.setControlState('jump', false)
        await new Promise(r => setTimeout(r, 200))
      }
      return `⬆️ Sauté ${times} fois !`
    }

    case 'sneak': {
      const enable = action.enable !== false
      bot.setControlState('sneak', enable)
      return enable ? '🦆 Sneak ON.' : '🧍 Sneak OFF.'
    }

    case 'afk': {
      bot.pathfinder.setGoal(null)
      bot.clearControlStates()
      return '😴 Mode AFK.'
    }

    // ── INVENTAIRE ────────────────────────────────────────────────
    case 'drop': {
      const itemName = action.item?.toLowerCase()
      if (!itemName) return '❌ Précise l\'item.'
      const items = bot.inventory.items().filter(i => i.name.toLowerCase().includes(itemName))
      if (!items.length) return `❌ Pas de "${itemName}".`
      for (const item of items) await bot.toss(item.type, null, action.count || item.count)
      return `🗑️ Jeté ${action.count || 'tout'} ${itemName}.`
    }

    case 'dropall': {
      const items = bot.inventory.items()
      if (!items.length) return '❌ Inventaire vide.'
      for (const item of items) await bot.toss(item.type, null, item.count)
      return '🗑️ Tout jeté !'
    }

    case 'eat': {
      const food = bot.inventory.items().find(i =>
        bot.registry?.foodsArray?.some(f => f.id === i.type)
      )
      if (!food) return '❌ Pas de nourriture.'
      await bot.equip(food, 'hand')
      await bot.consume()
      return `🍖 Mangé ${food.name}.`
    }

    case 'collect': {
      const item = bot.nearestEntity(e => e.type === 'object' && e.objectType === 'Item')
      if (!item) return '❌ Aucun item au sol.'
      bot.pathfinder.setMovements(getMovements(bot, false))
      bot.pathfinder.setGoal(new goals.GoalBlock(
        Math.floor(item.position.x), Math.floor(item.position.y), Math.floor(item.position.z)
      ))
      return '🎁 Je ramasse !'
    }

    // ── MINAGE / RÉCOLTE ──────────────────────────────────────────
    case 'mine': {
      const blockName = action.block?.toLowerCase()
      const count = action.count || 1
      if (!blockName) return '❌ Précise le bloc.'

      // Mapping complet nom → blocs Minecraft (normal + deepslate + nether)
      const blockMap = {
        'bois': ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log'],
        'wood': ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log'],
        'chene': ['oak_log'], 'oak': ['oak_log'],
        'bouleau': ['birch_log'], 'birch': ['birch_log'],
        'sapin': ['spruce_log'], 'spruce': ['spruce_log'],
        'diamant': ['diamond_ore', 'deepslate_diamond_ore'],
        'diamond': ['diamond_ore', 'deepslate_diamond_ore'],
        'fer': ['iron_ore', 'deepslate_iron_ore'],
        'iron': ['iron_ore', 'deepslate_iron_ore'],
        'or': ['gold_ore', 'deepslate_gold_ore'],
        'gold': ['gold_ore', 'deepslate_gold_ore'],
        'charbon': ['coal_ore', 'deepslate_coal_ore'],
        'coal': ['coal_ore', 'deepslate_coal_ore'],
        'redstone': ['redstone_ore', 'deepslate_redstone_ore'],
        'lapis': ['lapis_ore', 'deepslate_lapis_ore'],
        'emeraude': ['emerald_ore', 'deepslate_emerald_ore'],
        'netherite': ['ancient_debris'],
        'pierre': ['stone', 'cobblestone'],
        'stone': ['stone', 'cobblestone'],
        'sable': ['sand'],
        'gravier': ['gravel'],
        'terre': ['dirt', 'grass_block'],
        'obsidienne': ['obsidian'],
      }

      const targets = blockMap[blockName] || [blockName]
      sendDiscord(`⛏️ Je cherche du ${blockName}... (objectif: ${count})`)

      const mined = await mineBlockType(bot, targets, count, log, sendDiscord)

      if (mined === 0) return `❌ Pas de ${blockName} trouvé dans 64 blocs.`
      return `✅ J'ai miné ${mined} ${blockName} !`
    }

    // ── CRAFT ─────────────────────────────────────────────────────
    case 'craft': {
      const itemName = action.item?.toLowerCase()
      const count = action.count || 1
      if (!itemName) return '❌ Précise l\'item à craft.'

      const mcData = require('minecraft-data')(bot.version)

      // Mapping nom commun → nom technique
      const craftMap = {
        'planches': 'oak_planks', 'planks': 'oak_planks',
        'table de craft': 'crafting_table', 'crafting table': 'crafting_table',
        'table': 'crafting_table',
        'bâtons': 'stick', 'batons': 'stick', 'stick': 'stick', 'sticks': 'stick',
        'four': 'furnace', 'furnace': 'furnace',
        'coffre': 'chest', 'chest': 'chest',
        'hache': 'wooden_axe', 'axe': 'wooden_axe',
        'hache en bois': 'wooden_axe',
        'hache en pierre': 'stone_axe',
        'hache en fer': 'iron_axe',
        'pioche': 'wooden_pickaxe', 'pickaxe': 'wooden_pickaxe',
        'pioche en bois': 'wooden_pickaxe',
        'pioche en pierre': 'stone_pickaxe',
        'pioche en fer': 'iron_pickaxe',
        'pioche en diamant': 'diamond_pickaxe',
        'épée': 'wooden_sword', 'epee': 'wooden_sword', 'sword': 'wooden_sword',
        'épée en bois': 'wooden_sword',
        'épée en pierre': 'stone_sword',
        'épée en fer': 'iron_sword',
        'torche': 'torch', 'torch': 'torch',
        'torches': 'torch',
        'porte': 'oak_door', 'door': 'oak_door',
        'lit': 'white_bed', 'bed': 'white_bed',
        'arc': 'bow', 'bow': 'bow',
        'flèche': 'arrow', 'arrow': 'arrow',
        'seau': 'bucket', 'bucket': 'bucket',
      }

      const targetItem = craftMap[itemName] || itemName
      const itemData = mcData.itemsByName[targetItem]
      if (!itemData) return `❌ Je ne connais pas "${itemName}".`

      // Cherche une table de craft autour ou dans l'inventaire
      const craftingTable = bot.findBlock({
        matching: mcData.blocksByName['crafting_table']?.id,
        maxDistance: 6
      })

      try {
        let recipes
        if (craftingTable) {
          recipes = bot.recipesFor(itemData.id, null, 1, craftingTable)
        } else {
          recipes = bot.recipesFor(itemData.id, null, 1, null)
        }

        if (!recipes || recipes.length === 0) {
          return `❌ Pas de recette disponible pour ${itemName} (ou ingrédients manquants).`
        }

        if (craftingTable) {
          bot.pathfinder.setMovements(getMovements(bot, false))
          await bot.pathfinder.goto(new goals.GoalBlock(
            craftingTable.position.x, craftingTable.position.y, craftingTable.position.z
          ))
          await bot.craft(recipes[0], count, craftingTable)
        } else {
          await bot.craft(recipes[0], count, null)
        }

        log(`Crafté: ${count}x ${targetItem}`)
        return `🔨 J'ai crafté ${count}x ${targetItem} !`

      } catch (err) {
        return `❌ Craft échoué: ${err.message}`
      }
    }

    // ── PLACEMENT ─────────────────────────────────────────────────
    case 'place': {
      const blockName = action.block?.toLowerCase()
      const item = bot.inventory.items().find(i =>
        !blockName || i.name.toLowerCase().includes(blockName)
      )
      if (!item) return `❌ Pas de "${blockName || 'bloc'}" dans l'inventaire.`

      await bot.equip(item, 'hand')
      const pos = bot.entity.position
      const belowPos = new Vec3(Math.floor(pos.x), Math.floor(pos.y) - 1, Math.floor(pos.z))
      const refBlock = bot.blockAt(belowPos)

      if (!refBlock || refBlock.name === 'air') return '❌ Pas de surface sous moi.'

      try {
        await bot.placeBlock(refBlock, new Vec3(0, 1, 0))
        return `🧱 Posé ${item.name} !`
      } catch (err) {
        return `❌ Placement échoué: ${err.message}`
      }
    }

    // ── COMBAT ────────────────────────────────────────────────────
    case 'attack': {
      const mob = bot.nearestEntity(e =>
        e.type === 'mob' &&
        e.name?.toLowerCase().includes((action.target || '').toLowerCase())
      )
      if (!mob) return `❌ Aucun "${action.target || 'mob'}" trouvé.`
      bot.attack(mob)
      return `⚔️ J'attaque ${mob.name} !`
    }

    // ── FARMING AUTONOME ──────────────────────────────────────────
    case 'farm_wood': {
      // Farm de bois complet : abat + ramasse
      const count = action.count || 5
      sendDiscord(`🪓 Farming ${count} bois... je cherche des arbres`)

      const woodTypes = ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log']
      const mined = await mineBlockType(bot, woodTypes, count, log, sendDiscord)

      // Ramasse les drops
      await new Promise(r => setTimeout(r, 1500))
      const items = bot.nearestEntity(e => e.type === 'object' && e.objectType === 'Item')
      if (items) {
        bot.pathfinder.setMovements(getMovements(bot, false))
        bot.pathfinder.setGoal(new goals.GoalBlock(
          Math.floor(items.position.x), Math.floor(items.position.y), Math.floor(items.position.z)
        ))
        await new Promise(r => setTimeout(r, 2000))
      }

      return `🪓 Farmé ${mined} bois !`
    }

    case 'farm_food': {
      // Récolte les cultures proches (blé, carottes, pommes de terre, etc.)
      const mcData = require('minecraft-data')(bot.version)
      const cropIds = ['wheat', 'carrots', 'potatoes', 'beetroots', 'melon', 'pumpkin']
        .map(c => mcData.blocksByName[c]?.id)
        .filter(Boolean)

      const block = bot.findBlock({ matching: cropIds, maxDistance: 32 })
      if (!block) return '❌ Pas de culture à récolter à portée.'

      bot.pathfinder.setMovements(getMovements(bot, true))
      await bot.pathfinder.goto(new goals.GoalBlock(block.position.x, block.position.y, block.position.z))
      await bot.dig(block)
      sendDiscord(`🌾 Récolte de ${block.name} !`)
      return `🌾 J'ai récolté ${block.name} !`
    }

    case 'kill_mobs': {
      // Tue les mobs hostiles proches
      const hostile = ['zombie', 'skeleton', 'creeper', 'spider']
      let killed = 0
      const maxKill = action.count || 5

      while (killed < maxKill) {
        const mob = bot.nearestEntity(e =>
          e.type === 'mob' && hostile.some(h => e.name?.includes(h)) &&
          e.position.distanceTo(bot.entity.position) < 20
        )
        if (!mob) break

        bot.pathfinder.setMovements(getMovements(bot, false))
        bot.pathfinder.setGoal(new goals.GoalFollow(mob, 1), true)
        await new Promise(r => setTimeout(r, 500))
        bot.attack(mob)
        await new Promise(r => setTimeout(r, 1000))
        killed++
      }

      return `⚔️ Éliminé ${killed} mobs !`
    }

    default:
      return `❓ Action inconnue: ${action.action}`
  }
}

module.exports = { initPathfinder, executeAction }

// ── ACTIONS AUTONOMES (ajout) ─────────────────────────────────────
// Ces actions sont appelées depuis bot.js après import de task.js
