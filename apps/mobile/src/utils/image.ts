import * as FileSystem from 'expo-file-system/legacy'

export async function readImageAsBase64DataUrl(uri: string, mimeType = 'image/jpeg'): Promise<string> {
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  })
  return `data:${mimeType};base64,${base64}`
}
