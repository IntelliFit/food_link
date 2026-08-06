export interface StreamingDecodeOptions {
  stream?: boolean
}

export interface StreamingUTF8Decoder {
  decode(input?: ArrayBuffer | ArrayBufferView, options?: StreamingDecodeOptions): string
}

function toBytes(input?: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (!input) return new Uint8Array(0)
  if (input instanceof ArrayBuffer) return new Uint8Array(input)
  return new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
}

function codePointToString(codePoint: number): string {
  if (codePoint <= 0xffff) return String.fromCharCode(codePoint)
  const offset = codePoint - 0x10000
  return String.fromCharCode(0xd800 + (offset >> 10), 0xdc00 + (offset & 0x3ff))
}

/**
 * 小程序真机不保证存在浏览器的 TextDecoder。这里用纯 JS 增量解码 UTF-8，
 * 并保留 chunk 末尾未完成的多字节字符，避免中文跨分块时破坏 SSE JSON。
 */
export function createStreamingUTF8Decoder(): StreamingUTF8Decoder {
  let pending = new Uint8Array(0)

  return {
    decode(input, options) {
      const incoming = toBytes(input)
      const bytes = new Uint8Array(pending.length + incoming.length)
      bytes.set(pending, 0)
      bytes.set(incoming, pending.length)
      pending = new Uint8Array(0)

      const output: string[] = []
      let index = 0
      while (index < bytes.length) {
        const first = bytes[index]
        if (first <= 0x7f) {
          output.push(String.fromCharCode(first))
          index += 1
          continue
        }

        let width = 0
        let codePoint = 0
        let minimum = 0
        if (first >= 0xc2 && first <= 0xdf) {
          width = 2
          codePoint = first & 0x1f
          minimum = 0x80
        } else if (first >= 0xe0 && first <= 0xef) {
          width = 3
          codePoint = first & 0x0f
          minimum = 0x800
        } else if (first >= 0xf0 && first <= 0xf4) {
          width = 4
          codePoint = first & 0x07
          minimum = 0x10000
        } else {
          output.push('\ufffd')
          index += 1
          continue
        }

        if (index + width > bytes.length) {
          if (options?.stream) {
            pending = bytes.slice(index)
          } else {
            output.push('\ufffd')
          }
          break
        }

        let valid = true
        for (let offset = 1; offset < width; offset += 1) {
          const continuation = bytes[index + offset]
          if ((continuation & 0xc0) !== 0x80) {
            valid = false
            break
          }
          codePoint = (codePoint << 6) | (continuation & 0x3f)
        }

        if (
          !valid ||
          codePoint < minimum ||
          codePoint > 0x10ffff ||
          (codePoint >= 0xd800 && codePoint <= 0xdfff)
        ) {
          output.push('\ufffd')
          index += 1
          continue
        }

        output.push(codePointToString(codePoint))
        index += width
      }

      return output.join('')
    },
  }
}
