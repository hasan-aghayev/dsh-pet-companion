import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { imageSize } from 'image-size'

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/
const MAX_ASSET_BYTES = 25 * 1024 * 1024
const ALLOWED_IMAGE_EXTENSIONS = new Set(['.png', '.webp'])

function containedFile(directory, relativePath) {
  if (typeof relativePath !== 'string' || relativePath.length === 0 || path.isAbsolute(relativePath)) {
    throw new Error('image path must be a relative path inside the pet folder')
  }
  const root = path.resolve(directory)
  const file = path.resolve(root, relativePath)
  if (!file.startsWith(root + path.sep)) throw new Error('image path escapes the pet folder')
  if (!ALLOWED_IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase())) {
    throw new Error('pet images must use .png or .webp')
  }
  return file
}

async function parsePetDirectory(directory, source) {
  const manifestFile = path.join(directory, 'pet.json')
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'))
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('pet.json must contain an object')
  if (typeof manifest.id !== 'string' || !ID_PATTERN.test(manifest.id)) throw new Error('id must use lowercase letters, digits, and hyphens')
  if (typeof manifest.displayName !== 'string' || !manifest.displayName.trim() || manifest.displayName.length > 48) {
    throw new Error('displayName must contain 1–48 characters')
  }

  let mode
  let imagePath
  let dimensions
  if (manifest.spriteVersionNumber === 2 && typeof manifest.spritesheetPath === 'string') {
    mode = 'atlas-v2'
    imagePath = containedFile(directory, manifest.spritesheetPath)
    dimensions = imageSize(await readFile(imagePath))
    if (dimensions.width !== 1536 || dimensions.height !== 2288) {
      throw new Error('Hatch-Pet v2 atlas must be exactly 1536×2288 pixels (8 columns × 11 rows)')
    }
  } else if (manifest.format === 'portrait' && typeof manifest.imagePath === 'string') {
    mode = 'portrait'
    imagePath = containedFile(directory, manifest.imagePath)
    dimensions = imageSize(await readFile(imagePath))
    if (!dimensions.width || !dimensions.height || dimensions.width > 4096 || dimensions.height > 4096) {
      throw new Error('portrait image dimensions must be between 1 and 4096 pixels')
    }
  } else {
    throw new Error('expected a Hatch-Pet v2 atlas or format "portrait" with imagePath')
  }

  const imageStat = await stat(imagePath)
  if (!imageStat.isFile() || imageStat.size > MAX_ASSET_BYTES) throw new Error('image must be a file smaller than 25 MB')
  return {
    id: manifest.id,
    displayName: manifest.displayName.trim(),
    displayNameZh: typeof manifest.displayNameZh === 'string' ? manifest.displayNameZh.slice(0, 48) : '',
    description: typeof manifest.description === 'string' ? manifest.description.slice(0, 240) : '',
    descriptionZh: typeof manifest.descriptionZh === 'string' ? manifest.descriptionZh.slice(0, 240) : '',
    mode,
    imagePath,
    width: dimensions.width,
    height: dimensions.height,
    source,
  }
}

async function scanRoot(root, source, results, errors) {
  let entries
  try { entries = await readdir(root, { withFileTypes: true }) } catch (error) {
    if (error.code !== 'ENOENT') errors.push(root + ': ' + error.message)
    return
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const directory = path.join(root, entry.name)
    try {
      const pet = await parsePetDirectory(directory, source)
      if (source === 'user' && pet.id !== entry.name) throw new Error('folder name must match pet.json id')
      if (results.has(pet.id)) {
        errors.push(pet.id + ': a built-in pet already uses this id')
        continue
      }
      results.set(pet.id, pet)
    } catch (error) {
      errors.push(entry.name + ': ' + error.message)
    }
  }
}

export async function discoverPets(builtInRoot, userRoot) {
  const pets = new Map()
  const errors = []
  await scanRoot(builtInRoot, 'built-in', pets, errors)
  await scanRoot(userRoot, 'user', pets, errors)
  return { pets: [...pets.values()].sort((a, b) => a.displayName.localeCompare(b.displayName)), errors }
}

export function publicPet(pet) {
  return {
    id: pet.id,
    displayName: pet.displayName,
    displayNameZh: pet.displayNameZh,
    description: pet.description,
    descriptionZh: pet.descriptionZh,
    mode: pet.mode,
    imagePath: pet.imagePath,
    width: pet.width,
    height: pet.height,
    source: pet.source,
  }
}
