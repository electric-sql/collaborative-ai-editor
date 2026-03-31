interface OpenAiStreamOptions {
  apiKey: string
  model: string
  systemPrompt: string
  userPrompt: string
  signal?: AbortSignal
}

function toResponsesInput(role: 'system' | 'user', text: string) {
  return {
    role,
    content: [{ type: 'input_text', text }],
  }
}

export async function* streamOpenAiText(
  options: OpenAiStreamOptions,
): AsyncGenerator<string> {
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify({
      model: options.model,
      stream: true,
      input: [
        toResponsesInput('system', options.systemPrompt),
        toResponsesInput('user', options.userPrompt),
      ],
    }),
    signal: options.signal,
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(
      `OpenAI responses request failed (${res.status})${detail ? `: ${detail.slice(0, 280)}` : ''}`,
    )
  }

  if (!res.body) {
    throw new Error('OpenAI responses request returned no body')
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let emitted = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    while (true) {
      const lineEnd = buffer.indexOf('\n')
      if (lineEnd < 0) break
      const line = buffer.slice(0, lineEnd).trimEnd()
      buffer = buffer.slice(lineEnd + 1)

      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue

      let event: unknown
      try {
        event = JSON.parse(payload)
      } catch {
        continue
      }

      if (!event || typeof event !== 'object') continue
      const e = event as { type?: unknown; delta?: unknown }
      if (e.type === 'response.output_text.delta' && typeof e.delta === 'string') {
        emitted += e.delta
        yield e.delta
        continue
      }

      if (e.type === 'response.completed') {
        const response = event as {
          response?: { output_text?: unknown }
        }
        if (typeof response.response?.output_text === 'string') {
          const full = response.response.output_text
          if (full.startsWith(emitted)) {
            const tail = full.slice(emitted.length)
            if (tail.length > 0) {
              emitted += tail
              yield tail
            }
          } else if (emitted.length === 0 && full.length > 0) {
            emitted = full
            yield full
          }
        }
      }
    }
  }
}
