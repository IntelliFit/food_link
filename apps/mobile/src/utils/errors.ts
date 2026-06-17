const technicalErrorPattern = /(api error|request id|request_id|invalidparameter|while downloading|status code|image_url|task_id|task id|任务编号|缺少.*id|缺少.*ID|sqlstate|internal server error|panic|stack trace|doubao|openai|resource not found|invalid character|unexpected token|beginning of value|json parse|syntaxerror)/i

export function userFacingErrorMessage(error: unknown, fallback = '请稍后重试'): string {
  return userFacingMessage(rawErrorMessage(error), fallback)
}

export function userFacingMessage(message: unknown, fallback = '请稍后重试'): string {
  const text = extractMessageText(message).trim()
  if (!text) return fallback
  if (technicalErrorPattern.test(text)) return fallback
  return text
}

function rawErrorMessage(error: unknown): unknown {
  if (error instanceof Error) return error.message
  return error
}

function extractMessageText(message: unknown): string {
  if (typeof message !== 'string') return ''
  const text = message.trim()
  if (!text) return ''
  try {
    const parsed = JSON.parse(text) as unknown
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>
      const nested = record.error && typeof record.error === 'object' ? (record.error as Record<string, unknown>) : null
      return String(record.message || nested?.message || text)
    }
  } catch {
    // Plain text from the server is handled below.
  }
  return text
}
