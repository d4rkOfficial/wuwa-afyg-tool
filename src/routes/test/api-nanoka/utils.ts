import type { Manifest, CharacterEntry, WeaponEntry, EchoEntry, SonataSet } from './types'
import { NANOKA_BASE } from './consts'

export async function fetchManifest(): Promise<Manifest> {
    const r = await fetch(`${NANOKA_BASE}/manifest.json`)
    return r.json()
}

export async function fetchData<T>(path: string): Promise<T> {
    const r = await fetch(path)
    return r.json()
}
