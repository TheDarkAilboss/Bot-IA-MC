// ── Module de survie automatique ─────────────────────────────────
// Gère la faim, la fuite et le combat de façon autonome

const { Movements, goals } = require('mineflayer-pathfinder')

const FOOD_THRESHOLD = 14    // Mange si faim < 14/20
const FLEE_HEALTH = 5        // Fuit si vie < 5/20
const ATTACK_RANGE = 4       // Attaque les mobs hostiles dans ce rayon (blocs)
const FLEE_DISTANCE = 20     // Distance de fuite

const HOSTILE_MOBS = [
  'zombie', 'skeleton', 'creeper', 'spider', 'cave_spider',
  'enderman', 'witch', 'pillager', 'vindicator', 'ravager',
  'phantom', 'drowned', 'husk', 'stray', 'slime', 'magma_cube',
  'blaze', 'ghast', 'wither_skeleton', 'piglin_brute'
]

let survivalLoop = null
let isFleeing = false
let isEating = false
let isAttacking = false

function isHostile(entity) {
  return HOSTILE_MOBS.some(mob => entity.name?.toLowerCase().includes(mob))
}

function getMovements(bot) {
  const mcData = require('minecraft-data')(bot.version)
  const movements = new Movements(bot, mcData)
  movements.canDig = false
  movements.allowSprinting = true
  return movements
}

async function tryEat(bot, log, sendDiscord) {
  if (isEating) return
  const foodItems = bot.inventory.items().filter(i =>
    bot.registry?.foodsArray?.some(f => f.id === i.type)
  )
  if (foodItems.length === 0) {
    log('Survie: faim mais pas de nourriture dans l\'inventaire !')
    return
  }

  isEating = true
  try {
    const food = foodItems[0]
    await bot.equip(food, 'hand')
    await bot.consume()
    log(`Survie: mangé ${food.name} (faim: ${bot.food}/20)`)
    sendDiscord(`🍖 Mangé automatiquement: ${food.name} (faim était ${bot.food}/20)`)
  } catch (err) {
    log(`Survie: erreur manger — ${err.message}`)
  }
  isEating = false
}

async function tryFlee(bot, threat, log, sendDiscord) {
  if (isFleeing) return
  isFleeing = true

  const pos = bot.entity.position
  const threatPos = threat.position

  // Direction opposée à la menace
  const dx = pos.x - threatPos.x
  const dz = pos.z - threatPos.z
  const length = Math.sqrt(dx * dx + dz * dz) || 1

  const fleeX = Math.floor(pos.x + (dx / length) * FLEE_DISTANCE)
  const fleeZ = Math.floor(pos.z + (dz / length) * FLEE_DISTANCE)

  log(`Survie: fuite de ${threat.name} vers X:${fleeX} Z:${fleeZ}`)
  sendDiscord(`🏃 **Fuite !** Vie critique (${Math.floor(bot.health)}/20), je fuis ${threat.name} !`)

  try {
    bot.pathfinder.setMovements(getMovements(bot))
    await bot.pathfinder.goto(new goals.GoalBlock(fleeX, Math.floor(pos.y), fleeZ))
  } catch (err) {
    log(`Survie: erreur fuite — ${err.message}`)
  }

  isFleeing = false
}

function tryAttack(bot, mob, log, sendDiscord) {
  if (isAttacking) return
  isAttacking = true

  try {
    bot.attack(mob)
    log(`Survie: attaque ${mob.name}`)
    sendDiscord(`⚔️ **Combat !** J'attaque ${mob.name} qui s'approche !`)
  } catch (err) {
    log(`Survie: erreur attaque — ${err.message}`)
  }

  setTimeout(() => { isAttacking = false }, 1000)
}

function startSurvival(bot, log, sendDiscord) {
  if (survivalLoop) clearInterval(survivalLoop)

  survivalLoop = setInterval(async () => {
    if (!bot?.entity) return

    // ── 1. Gestion de la faim ──────────────────────────────────
    if (bot.food <= FOOD_THRESHOLD && !isEating) {
      await tryEat(bot, log, sendDiscord)
    }

    // ── 2. Détection des mobs hostiles proches ────────────────
    const nearbyHostile = bot.nearestEntity(e =>
      e.type === 'mob' && isHostile(e) &&
      e.position.distanceTo(bot.entity.position) <= ATTACK_RANGE
    )

    if (nearbyHostile) {
      const dist = nearbyHostile.position.distanceTo(bot.entity.position)

      // Vie critique → fuite prioritaire
      if (bot.health <= FLEE_HEALTH) {
        await tryFlee(bot, nearbyHostile, log, sendDiscord)
      } else {
        // Sinon se défend
        tryAttack(bot, nearbyHostile, log, sendDiscord)
      }
    }

  }, 1000) // Vérifie toutes les secondes

  log('Survie automatique activée (faim + combat + fuite)')
}

function stopSurvival() {
  if (survivalLoop) {
    clearInterval(survivalLoop)
    survivalLoop = null
  }
}

module.exports = { startSurvival, stopSurvival }
