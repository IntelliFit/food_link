import { useEffect, useState } from 'react'

export type ReleaseArtifact = {
  filename: string
  key: string
  url: string
  sha256?: string
  sizeBytes?: number
  contentType?: string
}

export type ReleaseChannelManifest = {
  version: string
  buildNumber: string
  buildKind?: string
  releasedAt?: string
  channel?: string
  releaseManifestUrl?: string
  url?: string
  artifacts?: {
    apk?: ReleaseArtifact
    aab?: ReleaseArtifact
  }
}

export function useReleaseChannel(url: string) {
  const [manifest, setManifest] = useState<ReleaseChannelManifest | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    const requestUrl = new URL(url)
    requestUrl.searchParams.set('ts', Date.now().toString())

    fetch(requestUrl.toString(), {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`release manifest request failed: ${response.status}`)
        }
        return response.json() as Promise<ReleaseChannelManifest>
      })
      .then((payload) => {
        setManifest(payload)
        setFailed(false)
      })
      .catch((error) => {
        if ((error as Error).name !== 'AbortError') {
          setFailed(true)
        }
      })

    return () => controller.abort()
  }, [url])

  return { manifest, failed }
}
