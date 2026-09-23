import { access, cp, mkdir, rename } from 'node:fs/promises'
import path from 'node:path'

async function exists(target) {
  try {
    await access(target)
    return true
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

export async function prepareDirectoryRoot(currentRoot, legacyRoot) {
  const [hasCurrent, hasLegacy] = await Promise.all([exists(currentRoot), exists(legacyRoot)])

  if (!hasCurrent && hasLegacy) {
    await mkdir(path.dirname(currentRoot), { recursive: true })
    try {
      await rename(legacyRoot, currentRoot)
    } catch (moveError) {
      // A running Windows companion can keep its old Electron cache in use.
      // Copy it into the new location in that case, preserving the old files.
      await mkdir(currentRoot, { recursive: true })
      try {
        await cp(legacyRoot, currentRoot, { recursive: true, force: false, errorOnExist: false })
      } catch (copyError) {
        copyError.cause ??= moveError
        throw copyError
      }
    }
    return currentRoot
  }

  await mkdir(currentRoot, { recursive: true })
  if (hasCurrent && hasLegacy) {
    await cp(legacyRoot, currentRoot, { recursive: true, force: false, errorOnExist: false })
  }
  return currentRoot
}

export async function prepareDataRoot(dshHome) {
  return prepareDirectoryRoot(
    path.join(dshHome, 'pet-companion'),
    path.join(dshHome, 'lokki-companion'),
  )
}
