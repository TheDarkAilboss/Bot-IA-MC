// ── Module de tâches autonomes ────────────────────────────────────
// Enchaîne automatiquement les étapes pour accomplir un objectif complexe

const { Movements, goals } = require('mineflayer-pathfinder')
const Vec3 = require('vec3')

function getMovements(bot, canDig = false) {
  const mcData = require('minecraft-data')(bot.version)
  const movements = new Movements(bot, mcData)
  movements.canDig = canDig
  movements.allowSprinting = true
  return movements
}

// ── Utilitaires ───────────────────────────────────────────────────

function hasItem(bot, itemName, count = 1) {
  const items = bot.inventory.items().filter(i => i.name.includes(itemName))
  const total = items.reduce((sum, i) => sum + i.count, 0)
  return total >= count
}

function countItem(bot, itemName) {
  return bot.inventory.items()
    .filter(i => i.name.includes(itemName))
    .reduce((sum, i) => sum + i.count, 0)
}

async function goTo(bot, pos) {
  bot.pathfinder.setMovements(getMovements(bot, false))
  await bot.pathfinder.goto(new goals.GoalBlock(
    Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z)
  ))
}

async function equipBestTool(bot, block) {
  const mcData = require('minecraft-data')(bot.version)
  const items = bot.inventory.items()
  let best = null
  for (const item of items) {
    const name = item.name
    if ((block.name.includes('log') || block.name.includes('wood')) && name.includes('axe')) { best = item; break }
    if ((block.name.includes('ore') || block.name.includes('stone') || block.name.includes('cobble')) && name.includes('pickaxe')) { best = item; break }
    if ((block.name.includes('dirt') || block.name.includes('grass') || block.name.includes('sand')) && name.includes('shovel')) { best = item; break }
  }
  if (best) await bot.equip(best, 'hand')
}

async function mineBlocks(bot, blockNames, count, log) {
  const mcData = require('minecraft-data')(bot.version)
  const ids = blockNames.map(n => mcData.blocksByName[n]?.id).filter(Boolean)
  let mined = 0
  while (mined < count) {
    const block = bot.findBlock({ matching: ids, maxDistance: 64 })
    if (!block) break
    try {
      bot.pathfinder.setMovements(getMovements(bot, true))
      await bot.pathfinder.goto(new goals.GoalBlock(block.position.x, block.position.y, block.position.z))
      await equipBestTool(bot, block)
      await bot.dig(block)
      mined++
      await new Promise(r => setTimeout(r, 300))
    } catch (err) {
      log(`mineBlocks erreur: ${err.message}`)
      break
    }
  }
  return mined
}

async function craftItem(bot, itemTechName, count, log) {
  const mcData = require('minecraft-data')(bot.version)
  const itemData = mcData.itemsByName[itemTechName]
  if (!itemData) { log(`craftItem: item inconnu ${itemTechName}`); return false }

  // Cherche une table de craft
  const table = bot.findBlock({
    matching: mcData.blocksByName['crafting_table']?.id,
    maxDistance: 32
  })

  try {
    let recipes
    if (table) {
      await goTo(bot, table.position)
      recipes = bot.recipesFor(itemData.id, null, 1, table)
    } else {
      recipes = bot.recipesFor(itemData.id, null, 1, null)
    }
    if (!recipes?.length) { log(`craftItem: pas de recette pour ${itemTechName}`); return false }
    await bot.craft(recipes[0], count, table || null)
    log(`Crafté: ${count}x ${itemTechName}`)
    return true
  } catch (err) {
    log(`craftItem erreur: ${err.message}`)
    return false
  }
}

async function placeBlock(bot, itemName, log) {
  const item = bot.inventory.items().find(i => i.name.includes(itemName))
  if (!item) return null
  await bot.equip(item, 'hand')
  const pos = bot.entity.position
  // Cherche une surface solide autour pour poser
  const offsets = [
    new Vec3(0, -1, 0), new Vec3(1, 0, 0), new Vec3(-1, 0, 0),
    new Vec3(0, 0, 1), new Vec3(0, 0, -1)
  ]
  for (const offset of offsets) {
    const refPos = pos.floored().plus(offset)
    const refBlock = bot.blockAt(refPos)
    if (refBlock && refBlock.name !== 'air') {
      try {
        const faceDir = new Vec3(-offset.x, offset.y === -1 ? 1 : 0, -offset.z)
        if (offset.y === -1) faceDir.set(0, 1, 0)
        await bot.placeBlock(refBlock, faceDir)
        return refBlock
      } catch { continue }
    }
  }
  return null
}

async function smeltItem(bot, fuelName, inputName, outputName, count, log, sendDiscord) {
  const mcData = require('minecraft-data')(bot.version)

  // 1. Cherche ou place un four
  let furnace = bot.findBlock({
    matching: mcData.blocksByName['furnace']?.id,
    maxDistance: 32
  })

  if (!furnace) {
    sendDiscord('🔥 Pas de four nearby, j\'en place un...')
    // Craft un four si besoin
    if (!hasItem(bot, 'furnace')) {
      // Besoin de 8 cobblestone
      if (countItem(bot, 'cobblestone') < 8) {
        sendDiscord('⛏️ Je mine de la pierre pour le four...')
        await mineBlocks(bot, ['stone', 'cobblestone'], 8, log)
        await craftItem(bot, 'cobblestone', 1, log) // convertit stone en cobble si besoin
      }
      await craftItem(bot, 'furnace', 1, log)
    }
    // Place le four
    await placeBlock(bot, 'furnace', log)
    await new Promise(r => setTimeout(r, 500))
    furnace = bot.findBlock({
      matching: mcData.blocksByName['furnace']?.id,
      maxDistance: 8
    })
    if (!furnace) return '❌ Impossible de placer un four.'
  }

  // 2. Va au four
  await goTo(bot, furnace.position)

  // 3. Ouvre le four
  try {
    const furnaceBlock = await bot.openFurnace(furnace)

    // 4. Met le carburant
    const fuel = bot.inventory.items().find(i => i.name.includes(fuelName))
    if (!fuel) {
      furnaceBlock.close()
      return `❌ Pas de ${fuelName} comme carburant.`
    }
    await furnaceBlock.putFuel(fuel.type, null, fuel.count)

    // 5. Met l'item à cuire
    const input = bot.inventory.items().find(i => i.name.includes(inputName))
    if (!input) {
      furnaceBlock.close()
      return `❌ Pas de ${inputName} à cuire.`
    }
    await furnaceBlock.putInput(input.type, null, Math.min(count, input.count))

    sendDiscord(`🔥 Four allumé ! Cuisson de ${inputName} en cours...`)

    // 6. Attendre la cuisson (environ 10s par item)
    const waitTime = Math.min(count, input.count) * 10000
    await new Promise(r => setTimeout(r, Math.min(waitTime, 60000)))

    // 7. Récupère le résultat
    await furnaceBlock.takeOutput()
    furnaceBlock.close()

    log(`Cuit: ${count}x ${inputName} → ${outputName}`)
    return `✅ Cuit ${count}x ${inputName} !`
  } catch (err) {
    return `❌ Erreur four: ${err.message}`
  }
}

// ── TÂCHES AUTONOMES COMPLÈTES ────────────────────────────────────

async function taskMakePick(bot, material, log, sendDiscord) {
  // Fabrique une pioche du matériau demandé de façon autonome
  const steps = {
    'bois': {
      handle: 'oak_planks', handleFrom: 'bois',
      head: 'oak_planks', needTable: false,
      pickName: 'wooden_pickaxe'
    },
    'pierre': {
      handle: 'oak_planks', handleFrom: 'bois',
      head: 'cobblestone', headFrom: 'pierre',
      needTable: true, pickName: 'stone_pickaxe'
    },
    'fer': {
      handle: 'oak_planks', handleFrom: 'bois',
      head: 'iron_ingot', headFrom: 'fer',
      needTable: true, pickName: 'iron_pickaxe',
      needSmelt: true, smeltInput: 'raw_iron', smeltOutput: 'iron_ingot'
    },
    'diamant': {
      handle: 'oak_planks', handleFrom: 'bois',
      head: 'diamond', headFrom: 'diamant',
      needTable: true, pickName: 'diamond_pickaxe'
    }
  }

  const plan = steps[material] || steps['bois']

  sendDiscord(`🔨 Fabrication pioche en ${material} — début des étapes...`)

  // Étape 1 : Bois
  if (!hasItem(bot, 'oak_log') && !hasItem(bot, 'oak_planks', 8)) {
    sendDiscord('🪓 Étape 1: Je mine du bois...')
    await mineBlocks(bot, ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log'], 3, log)
  }

  // Étape 2 : Planches
  if (!hasItem(bot, 'oak_planks', 8)) {
    sendDiscord('🪵 Étape 2: Je fais des planches...')
    await craftItem(bot, 'oak_planks', 4, log)
  }

  // Étape 3 : Bâtons
  if (!hasItem(bot, 'stick', 4)) {
    sendDiscord('🪹 Étape 3: Je fais des bâtons...')
    await craftItem(bot, 'stick', 4, log)
  }

  // Étape 4 : Table de craft si besoin
  if (plan.needTable) {
    const table = bot.findBlock({
      matching: require('minecraft-data')(bot.version).blocksByName['crafting_table']?.id,
      maxDistance: 16
    })
    if (!table) {
      sendDiscord('🪑 Étape 4: Je place une table de craft...')
      if (!hasItem(bot, 'crafting_table')) await craftItem(bot, 'crafting_table', 1, log)
      await placeBlock(bot, 'crafting_table', log)
      await new Promise(r => setTimeout(r, 500))
    }
  }

  // Étape 5 : Matériau de tête (pierre, fer, diamant)
  if (material === 'pierre' && !hasItem(bot, 'cobblestone', 3)) {
    sendDiscord('⛏️ Étape 5: Je mine de la pierre...')
    await mineBlocks(bot, ['stone', 'cobblestone'], 3, log)
  }
  if (material === 'fer' && !hasItem(bot, 'iron_ingot', 3)) {
    if (!hasItem(bot, 'raw_iron', 3)) {
      sendDiscord('⛏️ Étape 5: Je mine du fer...')
      await mineBlocks(bot, ['iron_ore', 'deepslate_iron_ore'], 3, log)
    }
    sendDiscord('🔥 Étape 6: Je fonds le fer...')
    if (!hasItem(bot, 'coal', 2) && !hasItem(bot, 'charcoal', 2)) {
      await mineBlocks(bot, ['coal_ore', 'deepslate_coal_ore'], 2, log)
    }
    await smeltItem(bot, 'coal', 'raw_iron', 'iron_ingot', 3, log, sendDiscord)
  }
  if (material === 'diamant' && !hasItem(bot, 'diamond', 3)) {
    sendDiscord('💎 Étape 5: Je mine du diamant...')
    await mineBlocks(bot, ['diamond_ore', 'deepslate_diamond_ore'], 3, log)
  }

  // Étape finale : Craft la pioche
  sendDiscord(`🔨 Étape finale: Je craft la pioche en ${material}...`)
  const crafted = await craftItem(bot, plan.pickName, 1, log)

  if (crafted) return `✅ Pioche en ${material} fabriquée de A à Z !`
  return `❌ Échec à l'étape du craft final.`
}

async function taskMakeSword(bot, material, log, sendDiscord) {
  sendDiscord(`⚔️ Fabrication épée en ${material}...`)

  // Bois de base
  if (!hasItem(bot, 'oak_planks', 4)) {
    await mineBlocks(bot, ['oak_log', 'birch_log', 'spruce_log'], 2, log)
    await craftItem(bot, 'oak_planks', 4, log)
  }
  if (!hasItem(bot, 'stick', 2)) await craftItem(bot, 'stick', 2, log)

  const swordMap = {
    'bois': 'wooden_sword',
    'pierre': 'stone_sword',
    'fer': 'iron_sword',
    'or': 'golden_sword',
    'diamant': 'diamond_sword'
  }

  if (material === 'pierre' && !hasItem(bot, 'cobblestone', 2)) {
    await mineBlocks(bot, ['stone', 'cobblestone'], 2, log)
  }
  if (material === 'fer' && !hasItem(bot, 'iron_ingot', 2)) {
    if (!hasItem(bot, 'raw_iron', 2)) await mineBlocks(bot, ['iron_ore', 'deepslate_iron_ore'], 2, log)
    if (!hasItem(bot, 'coal', 1)) await mineBlocks(bot, ['coal_ore'], 1, log)
    await smeltItem(bot, 'coal', 'raw_iron', 'iron_ingot', 2, log, sendDiscord)
  }

  if (!bot.findBlock({ matching: require('minecraft-data')(bot.version).blocksByName['crafting_table']?.id, maxDistance: 16 })) {
    if (!hasItem(bot, 'crafting_table')) await craftItem(bot, 'crafting_table', 1, log)
    await placeBlock(bot, 'crafting_table', log)
    await new Promise(r => setTimeout(r, 500))
  }

  const crafted = await craftItem(bot, swordMap[material] || 'wooden_sword', 1, log)
  return crafted ? `✅ Épée en ${material} faite !` : `❌ Craft échoué.`
}

async function taskSmelt(bot, what, count, log, sendDiscord) {
  // Cuire de façon autonome
  const smeltMap = {
    'fer': { input: 'raw_iron', output: 'iron_ingot' },
    'or': { input: 'raw_gold', output: 'gold_ingot' },
    'verre': { input: 'sand', output: 'glass' },
    'charbon de bois': { input: 'oak_log', output: 'charcoal' },
    'brique': { input: 'clay_ball', output: 'brick' },
    'pierre lisse': { input: 'stone', output: 'smooth_stone' },
    'nourriture': { input: 'beef', output: 'cooked_beef' },
    'viande': { input: 'beef', output: 'cooked_beef' },
    'boeuf': { input: 'beef', output: 'cooked_beef' },
    'poulet': { input: 'chicken', output: 'cooked_chicken' },
    'porc': { input: 'porkchop', output: 'cooked_porkchop' },
    'poisson': { input: 'cod', output: 'cooked_cod' },
  }

  const recipe = smeltMap[what?.toLowerCase()]
  if (!recipe) return `❌ Je ne sais pas cuire "${what}".`

  // Vérifie le carburant
  if (!hasItem(bot, 'coal') && !hasItem(bot, 'charcoal') && !hasItem(bot, 'oak_log')) {
    sendDiscord('🪓 Je récupère du bois comme carburant...')
    await mineBlocks(bot, ['oak_log', 'birch_log'], 2, log)
  }

  const fuel = hasItem(bot, 'coal') ? 'coal' : hasItem(bot, 'charcoal') ? 'charcoal' : 'oak_log'
  return await smeltItem(bot, fuel, recipe.input, recipe.output, count || 1, log, sendDiscord)
}

module.exports = { taskMakePick, taskMakeSword, taskSmelt, mineBlocks, craftItem, smeltItem, hasItem, countItem }
